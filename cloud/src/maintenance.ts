import {localClock,nextSlotRun} from '../../lib/schedule';
import {enqueueSlot} from './jobs';
import {publish} from './publish';
import type {SlotRow} from './slots';
import {HttpError} from './http';
import type {AppEnv} from './env';

export async function scanSchedule(env:AppEnv) {
  const at=new Date(),now=at.toISOString();
  const due=(await env.DB.prepare(`SELECT s.*,a.owner_id,a.timezone,a.revision AS agent_revision FROM post_slots s JOIN agents a ON a.id=s.agent_id
    WHERE s.enabled=1 AND a.active=1 AND a.paused=0 AND s.next_run_at<=?
      AND s.next_run_at<=strftime('%Y-%m-%dT%H:%M:%fZ',?,printf('+%d minutes',s.lead_minutes+8))
    ORDER BY s.next_run_at LIMIT 5`).bind(new Date(at.getTime()+728*60000).toISOString(),now).all<SlotRow&{owner_id:string;timezone:string;agent_revision:number}>()).results;
  for(const slot of due) {
    const date=localClock(slot.timezone,new Date(slot.next_run_at!)).date;
    const run=await env.DB.prepare('SELECT attempts,post_seq FROM slot_runs WHERE slot_id=? AND run_date=?').bind(slot.id,date).first<{attempts:number;post_seq:number|null}>();
    if(Date.parse(slot.next_run_at!)<at.getTime()-45*60000||(run&&((run.post_seq!==null)||run.attempts>=3))) {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO slot_runs(slot_id,run_date,scheduled_for,outcome,detail) VALUES(?,?,?,'missed','This occurrence could not be prepared in time.') ON CONFLICT DO NOTHING`).bind(slot.id,date,slot.next_run_at),
        env.DB.prepare('UPDATE post_slots SET next_run_at=? WHERE id=? AND revision=? AND next_run_at=?').bind(nextSlotRun(slot.timezone,slot.local_time,slot.days_mask,new Date(Math.max(at.getTime(),Date.parse(slot.next_run_at!))))!.toISOString(),slot.id,slot.revision,slot.next_run_at),
      ]);
    }else await enqueueSlot(env.DB,slot,slot.owner_id,slot.agent_revision,date,slot.next_run_at!);
  }
  await env.DB.prepare(`INSERT INTO system_status(key,value,updated_at) VALUES('cloud_scheduler','{}',?) ON CONFLICT(key) DO UPDATE SET updated_at=excluded.updated_at`).bind(now).run();
}
export async function publishDue(env:AppEnv) {
  if(env.LINKEDIN_LIVE!=='true')return;
  const now=new Date().toISOString(),late=new Date(Date.now()-45*60000).toISOString();
  await env.DB.prepare(`UPDATE posts SET status='missed',cleared_at=NULL WHERE scheduled_for<? AND status IN ('draft','approved','failed')
    AND NOT EXISTS(SELECT 1 FROM distributions d WHERE d.agent_id=posts.agent_id AND d.seq=posts.seq AND d.status IN ('sent','in_flight','unknown'))`).bind(late).run();
  const due=(await env.DB.prepare(`SELECT p.agent_id,p.seq FROM posts p JOIN agents a ON a.id=p.agent_id LEFT JOIN post_slots s ON s.id=p.slot_id
    WHERE a.active=1 AND a.paused=0 AND p.status IN ('draft','approved') AND p.scheduled_for<=? AND p.scheduled_for>=?
      AND (p.hold_until IS NULL OR p.hold_until<=?) AND (p.cleared_at IS NOT NULL OR (a.auto_publish=1 AND s.auto_publish=1 AND s.enabled=1 AND p.review_notes_json='[]' AND p.requires_review=0))
      AND NOT EXISTS(SELECT 1 FROM distributions d WHERE d.agent_id=p.agent_id AND d.seq=p.seq AND d.status IN ('in_flight','sent','unknown')) ORDER BY p.scheduled_for LIMIT 3`)
    .bind(now,late,now).all<{agent_id:string;seq:number}>()).results;
  for(const p of due) {
    try {
      const result=await publish(env,p.agent_id,p.seq,'auto');
      await env.DB.prepare('INSERT INTO notification_outbox(agent_id,payload,dedupe_key) VALUES(?,?,?) ON CONFLICT DO NOTHING')
        .bind(p.agent_id,JSON.stringify({kind:result.ok?'published':'publish_failed',seq:p.seq}),`send:${p.agent_id}:${p.seq}`).run();
    } catch(error) {
      console.warn(JSON.stringify({event:'scheduled_publish_deferred',status:error instanceof HttpError?error.status:500}));
    }
  }
}
export async function cleanExpired(db:D1Database) {
  const before=(ms:number)=>new Date(Date.now()-ms).toISOString();
  await db.batch([
    db.prepare(`INSERT INTO notification_outbox(agent_id,payload,dedupe_key)
      SELECT agent_id,'{"kind":"token_expiring"}','token-expiring:' || agent_id || ':' || expires_at FROM linkedin_accounts
      WHERE expires_at<? ON CONFLICT DO NOTHING`).bind(new Date(Date.now()+7*86400000).toISOString()),
    db.prepare('DELETE FROM native_auth WHERE created_at<?').bind(before(3600000)),
    db.prepare('DELETE FROM oauth_states WHERE created_at<?').bind(before(3600000)),
    db.prepare('DELETE FROM login_attempts WHERE at<?').bind(before(86400000)),
    db.prepare('DELETE FROM byline_sessions WHERE expires_at<? OR revoked_at<?').bind(before(0),before(86400000)),
    db.prepare('DELETE FROM ai_usage WHERE created_at<?').bind(before(30*86400000)),
    db.prepare('DELETE FROM ai_requests WHERE updated_at<?').bind(Date.now()-86400000),
    db.prepare('DELETE FROM ai_service_days WHERE day<?').bind(before(30*86400000).slice(0,10)),
    db.prepare('DELETE FROM ai_reservations WHERE day<?').bind(before(30*86400000).slice(0,10)),
    db.prepare('DELETE FROM ai_user_days WHERE day<?').bind(before(30*86400000).slice(0,10)),
    db.prepare('DELETE FROM ai_provider_days WHERE day<?').bind(before(30*86400000).slice(0,10)),
    db.prepare("DELETE FROM generation_jobs WHERE state IN ('completed','failed') AND created_at<?").bind(before(30*86400000)),
    db.prepare('DELETE FROM notification_outbox WHERE delivered_at<?').bind(before(30*86400000)),
  ]);
}
