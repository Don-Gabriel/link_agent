import type { AppEnv } from './env';
import { HttpError } from './http';
import { type SlotRow } from './slots';
import { draftNoticeTime } from './notifications';
export interface GenerationJob {kind:'slot'|'manual';agentId:string;userId:string;agentRevision:number;slotRevision?:number;slotId?:string;runDate?:string;scheduledFor?:string;requested?:boolean}
/** Persist failure and its notification together; replay cannot duplicate it. */
export async function failJob(db:D1Database,id:string,agentId:string,reason:string) {
  const detail=reason.slice(0,200);
  await db.batch([
    db.prepare("UPDATE generation_jobs SET state='failed',error=?,updated_at=? WHERE id=? AND agent_id=? AND state!='completed'").bind(detail,new Date().toISOString(),id,agentId),
    db.prepare("UPDATE slot_runs SET outcome='failed',detail=?,retry_at=? WHERE job_id=? AND post_seq IS NULL").bind(detail,new Date(Date.now()+10*60000).toISOString(),id),
    db.prepare(`INSERT INTO notification_outbox(agent_id,payload,dedupe_key)
      SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM generation_jobs WHERE id=? AND agent_id=? AND state='failed') ON CONFLICT DO NOTHING`)
      .bind(agentId,JSON.stringify({kind:'draft_failed',detail}),`generation-failed:${id}`,id,agentId),
  ]);
}
export async function enqueueSlot(db:D1Database,slot:SlotRow,userId:string,agentRevision:number,date:string,scheduledFor:string,requested=false) {
  const id=crypto.randomUUID(),now=new Date().toISOString();
  const payload:GenerationJob={kind:'slot',agentId:slot.agent_id,userId,agentRevision,slotRevision:slot.revision,slotId:slot.id,runDate:date,scheduledFor,requested};
  const results=await db.batch([
    db.prepare(`INSERT INTO slot_runs(slot_id,run_date,scheduled_for,job_id,stage) SELECT ?,?,?,?,'discovering'
      WHERE EXISTS(SELECT 1 FROM agents WHERE id=? AND paused=0 AND active=1 AND revision=?)
      AND EXISTS(SELECT 1 FROM post_slots WHERE id=? AND enabled=1 AND revision=?)
      AND NOT EXISTS(SELECT 1 FROM posts WHERE agent_id=? AND slot_id=? AND slot_date=?)
      ON CONFLICT(slot_id,run_date) DO UPDATE SET job_id=excluded.job_id,outcome='pending',stage='discovering',detail=NULL,attempts=attempts+1,retry_at=?
      WHERE post_seq IS NULL AND attempts<3 AND retry_at<? AND (outcome!='pending' OR retry_at<?)`)
      .bind(slot.id,date,scheduledFor,id,slot.agent_id,agentRevision,slot.id,slot.revision,slot.agent_id,slot.id,date,now,now,new Date(Date.now()-20*60000).toISOString()),
    db.prepare(`INSERT INTO generation_jobs(id,agent_id,payload) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM slot_runs WHERE slot_id=? AND run_date=? AND job_id=?)`)
      .bind(id,slot.agent_id,JSON.stringify(payload),slot.id,date,id),
  ]);
  return results[1].meta.changes?id:null;
}
export async function enqueueManual(db:D1Database,payload:GenerationJob) {
  const id=crypto.randomUUID();
  const saved=await db.prepare(`INSERT INTO generation_jobs(id,agent_id,payload) SELECT ?,?,?
    WHERE NOT EXISTS(SELECT 1 FROM generation_jobs WHERE agent_id=? AND state IN ('queued','working'))
    AND (SELECT count(*) FROM generation_jobs WHERE agent_id=? AND created_at>?)<10 RETURNING id`)
    .bind(id,payload.agentId,JSON.stringify(payload),payload.agentId,payload.agentId,new Date(Date.now()-86400000).toISOString()).first();
  if(!saved)throw new HttpError(429,'Preparation is running or today’s preparation allowance has been reached.');
  return id;
}
/** The database outbox survives a failed Workflow create; the next cloud tick retries it. */
export async function dispatchJobs(env:AppEnv) {
  const jobs=(await env.DB.prepare("SELECT id,payload FROM generation_jobs WHERE state='queued' ORDER BY created_at LIMIT 10").all<{id:string;payload:string}>()).results;
  for(const job of jobs) {
    try {
      // createBatch ignores IDs that already exist, including after a lost acknowledgement.
      const created=await env.CONTENT.createBatch([{id:job.id,params:JSON.parse(job.payload) as GenerationJob}]);
      if(!created.length)await (await env.CONTENT.get(job.id)).status();
      await env.DB.prepare("UPDATE generation_jobs SET state='working',updated_at=? WHERE id=? AND state='queued'").bind(new Date().toISOString(),job.id).run();
    }catch {console.warn(JSON.stringify({event:'generation_dispatch_failed',job:job.id}));}
  }
}

/** A runtime failure can prevent the workflow's catch block from recording its outcome. */
export async function reconcileJobs(env:AppEnv) {
  const stale=(await env.DB.prepare("SELECT id,agent_id,payload FROM generation_jobs WHERE state='working' AND updated_at<? ORDER BY updated_at LIMIT 5")
    .bind(new Date(Date.now()-5*60000).toISOString()).all<{id:string;agent_id:string;payload:string}>()).results;
  for(const job of stale) {
    try {
      const state=await (await env.CONTENT.get(job.id)).status();
      if(!['errored','terminated','complete'].includes(state.status))continue;
      const saved=await env.DB.prepare('SELECT seq,created_at,status FROM posts WHERE agent_id=? AND client_request_id=?').bind(job.agent_id,job.id).first<{seq:number;created_at:string;status:string}>();
      if(saved) {
        const payload=JSON.parse(job.payload) as GenerationJob;
        const slot=payload.slotId?await env.DB.prepare('SELECT lead_minutes FROM post_slots WHERE id=? AND agent_id=?').bind(payload.slotId,job.agent_id).first<{lead_minutes:number}>():null;
        await env.DB.batch([
          env.DB.prepare("UPDATE generation_jobs SET state='completed',stage='ready',error=NULL,updated_at=? WHERE id=? AND state='working'").bind(new Date().toISOString(),job.id),
          env.DB.prepare('UPDATE slot_runs SET post_seq=?,generated_at=?,outcome=?,stage=\'ready\' WHERE job_id=? AND post_seq IS NULL').bind(saved.seq,saved.created_at,saved.status==='published'?'published':'drafted',job.id),
          env.DB.prepare('INSERT INTO notification_outbox(agent_id,payload,dedupe_key,retry_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(job.agent_id,JSON.stringify({kind:'draft_ready',seq:saved.seq}),`draft:${job.agent_id}:${saved.seq}`,draftNoticeTime(payload,slot?.lead_minutes??15)),
        ]);
        continue;
      }
      const reason='Background preparation stopped before completion. Please prepare the draft again.';
      await failJob(env.DB,job.id,job.agent_id,reason);
    }catch {console.warn(JSON.stringify({event:'generation_reconcile_deferred',job:job.id}));}
  }
}
