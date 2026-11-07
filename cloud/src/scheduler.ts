import { WorkflowEntrypoint,type WorkflowEvent,type WorkflowStep } from 'cloudflare:workers';
import { dispatchJobs,enqueueSlot,enqueueManual,reconcileJobs } from './jobs';
import {scanSchedule,publishDue,cleanExpired} from './maintenance';
import { drainNotifications } from './notifications';
import { listSlots,timetable } from './slots';
import { loadAgent } from './models';
import { body,HttpError,json } from './http';
import type { AppEnv } from './env';
import type { Owner } from './auth';

export class MaintenanceWorkflow extends WorkflowEntrypoint<AppEnv,{cleanup:boolean}> {
  async run(event:WorkflowEvent<{cleanup:boolean}>,step:WorkflowStep) {
    const retry={retries:{limit:2,delay:'15 seconds' as const,backoff:'exponential' as const}};
    await step.do('publish-due',retry,()=>publishDue(this.env));
    await step.do('deliver-notifications',retry,()=>drainNotifications(this.env));
    await step.do('scan-timetable',retry,()=>scanSchedule(this.env));
    await step.do('reconcile-drafts',retry,()=>reconcileJobs(this.env));
    await step.do('dispatch-drafts',retry,()=>dispatchJobs(this.env));
    if(event.payload.cleanup)await step.do('expire-old-records',retry,()=>cleanExpired(this.env.DB));
  }
}
export async function reviewRoute(request:Request,env:AppEnv,owner:Owner) {
  if(request.method==='GET')return json(await timetable(env.DB,owner));
  const b=await body(request);
  if(b.action==='notifications'&&['enabled','denied','unavailable'].includes(String(b.notifications))) {
    await env.DB.prepare("UPDATE onboarding SET config=json_set(config,'$.notifications',?) WHERE user_id=?").bind(b.notifications,owner.userId).run();return json({ok:true});
  }
  if(b.action!=='generate')throw new HttpError(400,'Choose a timetable entry to prepare.');
  const c=await loadAgent(env.DB,owner.agentId);
  const setup=await env.DB.prepare('SELECT completed_at FROM onboarding WHERE user_id=?').bind(owner.userId).first<{completed_at:string|null}>();
  if(!setup?.completed_at||c.settings.paused)throw new HttpError(409,'Finish setup and resume ByLine before preparing posts.');
  if(b.slotIds!==undefined&&(!Array.isArray(b.slotIds)||b.slotIds.some(s=>typeof s!=='string')))throw new HttpError(400,'Choose valid timetable entries.');
  const day=await timetable(env.DB,owner),slots=await listSlots(env.DB,owner.agentId);let count=0;
  for(const e of day.entries.filter(e=>e.canPrepare&&(!Array.isArray(b.slotIds)||!b.slotIds.length||b.slotIds.includes(e.slotId)))) {
    if(await enqueueSlot(env.DB,slots.find(s=>s.id===e.slotId)!,owner.userId,c.row.revision,day.date,e.scheduledFor,true))count++;
  }
  await dispatchJobs(env);
  return json({ok:true,accepted:count>0,count},202);
}
export async function cycleRoute(env:AppEnv,owner:Owner) {
  const c=await loadAgent(env.DB,owner.agentId);
  const setup=await env.DB.prepare('SELECT completed_at FROM onboarding WHERE user_id=?').bind(owner.userId).first<{completed_at:string|null}>();
  if(!setup?.completed_at||c.settings.paused)throw new HttpError(409,'Finish setup and resume ByLine before preparing a draft.');
  await enqueueManual(env.DB,{kind:'manual',agentId:owner.agentId,userId:owner.userId,agentRevision:c.row.revision});
  await dispatchJobs(env);return json({ok:true,accepted:true},202);
}
