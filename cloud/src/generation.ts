import { discover, type Candidate } from '../../lib/discovery-core';
import { judgeCandidates,PUBLISH_THRESHOLD } from '../../lib/judge-core';
import { writePost, type PriorPost } from '../../lib/writer-core';
import { parseSetup,setupCategories,setupPersona,setupStyle,type SetupConfig } from '../../lib/setup-config';
import { critique } from '../../lib/critique';
import { nextSlotRun } from '../../lib/schedule';
import { pickSamples } from '../../lib/voice-prompt';
import { completion,durableCompletion } from './ai';
import { loadAgent } from './models';
import { saveDraft } from './drafts';
import { failJob,type GenerationJob } from './jobs';
import type { AppEnv } from './env';
import type { SlotRow } from './slots';
import { generationError } from './generation-errors';
export type RunStep=<T extends Rpc.Serializable<T>>(name:string,work:()=>Promise<T>)=>Promise<T>;
export const directly:RunStep=(_name,work)=>work();
const memory={facts:[],source:'none' as const,degraded:false};
async function feedResult(db:D1Database,name:string,outcome:{ok:true;items:number}|{ok:false;error:string}) {
  const ok=outcome.ok&&outcome.items>0,now=new Date().toISOString();
  await db.prepare(`INSERT INTO feed_health(name,last_ok_at,last_failed_at,fails_in_a_row,last_error,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET last_ok_at=COALESCE(excluded.last_ok_at,last_ok_at),last_failed_at=COALESCE(excluded.last_failed_at,last_failed_at),
    fails_in_a_row=CASE WHEN excluded.last_ok_at IS NULL THEN fails_in_a_row+1 ELSE 0 END,last_error=excluded.last_error,updated_at=excluded.updated_at`)
    .bind(name,ok?now:null,ok?null:now,ok?0:1,ok?null:'Feed is unavailable or returned no stories.',now).run();
}
export async function generatePreview(env:AppEnv,userId:string,name:string,config:SetupConfig) {
  const categories=setupCategories(config),persona=setupPersona(config,name),style=setupStyle(config);
  const candidates=await discover((name,result)=>feedResult(env.DB,name,result),{categories,maxFetches:24,maxFeeds:12});
  const complete=completion(env,userId);
  const judged=await judgeCandidates(complete,persona,categories,candidates,memory,[]);
  if(!judged.ok)throw new Error(judged.reason);
  const source=judged.data.scored.find(s=>s.total>=PUBLISH_THRESHOLD);
  if(!source)throw new Error('No source closely matches your subjects yet. Try again later or adjust your subjects.');
  const draft=await writePost(complete,{persona,style,winner:source,runnersUp:[],memory,priorPosts:[],repairAttempts:2,samples:config.samples.map(text=>({text,origin:'corpus'}))});
  if(!draft.ok)throw new Error(draft.reason);
  if(critique(draft.data.text,style,{hashtags:draft.data.hashtags,usedQuote:draft.data.used_quote}).length)throw new Error('The sample needs another pass to match your writing preferences.');
  return {text:draft.data.text.trim()+(draft.data.hashtags.length?'\n\n'+draft.data.hashtags.map(h=>'#'+h).join(' '):''),sources:[source.url],title:source.title,testMode:false};
}
export async function generateJob(env:AppEnv,id:string,payload:GenerationJob,step:RunStep) {
  const complete=durableCompletion(completion(env,payload.userId));
  try {
    const context=await step('load-author',async()=>{
      const a=await loadAgent(env.DB,payload.agentId);
      if(!a.row.active||a.row.paused||a.row.revision!==payload.agentRevision)throw new Error('Preparation stopped because settings changed or ByLine was paused.');
      const slot=payload.slotId?await env.DB.prepare('SELECT * FROM post_slots WHERE id=? AND agent_id=?').bind(payload.slotId,payload.agentId).first<SlotRow>():null;
      if(payload.slotId&&(!slot||!slot.enabled||slot.revision!==payload.slotRevision))throw new Error('The posting time changed.');
      const rows=(await env.DB.prepare("SELECT id,fingerprint,text,category,used_quote,status FROM posts WHERE agent_id=? AND status!='rejected' ORDER BY seq DESC LIMIT 12").bind(payload.agentId).all<{id:string;fingerprint:string;text:string;category:string|null;used_quote:number;status:string}>()).results;
      return {...a,slot,rows};
    });
    const stage=async(name:string)=>{
      await env.DB.batch([
        env.DB.prepare('UPDATE generation_jobs SET stage=?,updated_at=? WHERE id=?').bind(name,new Date().toISOString(),id),
        env.DB.prepare('UPDATE slot_runs SET stage=? WHERE job_id=? AND outcome=\'pending\'').bind(name,id),
      ]);
    };
    await step('stage-discover',()=>stage('discovering'));
    const categories=context.slot&&JSON.parse(context.slot.categories_json).length?JSON.parse(context.slot.categories_json):context.settings.categories;
    const candidates:Candidate[]=await discover(
      (name,result)=>step(`feed-health:${name}`,()=>feedResult(env.DB,name,result)),{categories,maxFetches:24,maxFeeds:12},
      (name,work)=>step(`source:${name}`,work));
    await step('stage-judge',()=>stage('judging'));
    const judged=await step('judge',()=>judgeCandidates(complete,context.persona,categories,candidates,memory,context.rows.map(p=>p.fingerprint)));
    if(!judged.ok)throw new Error(judged.reason);
    const winner=judged.data.scored.find(s=>s.total>=PUBLISH_THRESHOLD);
    if(!winner)throw new Error('No suitable story cleared the relevance checks.');
    await step('stage-write',()=>stage('writing'));
    const priorPosts:PriorPost[]=context.rows.map(r=>({id:r.id,fingerprint:r.fingerprint,opening:r.text.slice(0,210),usedQuote:!!r.used_quote}));
    const draft=await step('write',()=>writePost(complete,{persona:context.persona,style:context.settings.style,winner,repairAttempts:2,
      runnersUp:judged.data.scored.slice(1,3),memory,priorPosts,samples:pickSamples(context.settings.corpus,context.rows.filter(p=>p.status==='published').map(p=>p.text)),editNotes:context.settings.editNotes}));
    if(!draft.ok)throw new Error(draft.reason);
    const violations=critique(draft.data.text,context.settings.style,{hashtags:draft.data.hashtags,usedQuote:draft.data.used_quote,sourceUrl:winner.url});
    if(violations.length){
      console.warn(JSON.stringify({event:'draft_quality_failed',job:id,rules:violations.map(v=>v.rule)}));
      throw new Error('The draft needs another pass to match your writing preferences.');
    }
    await step('stage-save',()=>stage('saving'));
    const seq=await step('save-draft',()=>saveDraft(env.DB,{agentId:payload.agentId,requestId:id,text:draft.data.text.trim(),rationale:draft.data.rationale,
      fingerprint:draft.data.fingerprint,sources:[winner.url],category:winner.category,hashtags:draft.data.hashtags,scores:winner.scores,continuity:draft.data.continuity,
      usedQuote:draft.data.used_quote,slotId:payload.slotId,slotDate:payload.runDate,agentRevision:payload.agentRevision,slotRevision:payload.slotRevision,
      scheduledFor:payload.scheduledFor&&Date.parse(payload.scheduledFor)>Date.now()?payload.scheduledFor:null}));
    await step('settle',async()=>{
      const now=new Date().toISOString();
      const queries=[env.DB.prepare("UPDATE slot_runs SET post_seq=?,generated_at=?,outcome='drafted',stage='ready' WHERE job_id=? AND post_seq IS NULL").bind(seq,now,id),
        env.DB.prepare(`INSERT INTO notification_outbox(agent_id,payload,dedupe_key) VALUES(?,?,?) ON CONFLICT DO NOTHING`).bind(payload.agentId,JSON.stringify({kind:'draft_ready',seq}),`draft:${payload.agentId}:${seq}`),
        env.DB.prepare(`INSERT INTO scheduler_state(agent_id,last_run_at,cycle_count) SELECT ?,?,1 WHERE EXISTS(SELECT 1 FROM generation_jobs WHERE id=? AND state!='completed') ON CONFLICT(agent_id) DO UPDATE SET last_run_at=excluded.last_run_at,cycle_count=cycle_count+1`).bind(payload.agentId,now,id)];
      if(context.slot)queries.push(env.DB.prepare('UPDATE post_slots SET next_run_at=? WHERE id=? AND revision=?').bind(nextSlotRun(context.settings.timezone,context.slot.local_time,context.slot.days_mask,new Date(Math.max(Date.now(),Date.parse(payload.scheduledFor!))))!.toISOString(),context.slot.id,context.slot.revision));
      queries.push(env.DB.prepare("UPDATE generation_jobs SET state='completed',stage='ready',updated_at=? WHERE id=? AND state!='completed'").bind(now,id));
      await env.DB.batch(queries);
    });
    return {seq};
  } catch(error) {
    const reason=generationError(error);
    await step('record-failure',()=>failJob(env.DB,id,payload.agentId,reason));
    return {error:reason};
  }
}
