import { nextSlotRun, slotOnDate, normalizeHhMm, localClock, describeDays, formatInZone } from '../../lib/schedule';
import { isCategoryId, MAX_SELECTED_CATEGORIES } from '../../lib/categories';
import { body,json,HttpError } from './http';
import { loadAgent, postView, type CloudPost } from './models';
import type { Owner } from './auth';
export const SLOT_LIMITS={maxSlots:5,minLeadMinutes:10,maxLeadMinutes:720,missedAfterMinutes:45};
export interface SlotRow {id:string;agent_id:string;local_time:string;days_mask:number;lead_minutes:number;auto_publish:number;categories_json:string;enabled:number;position:number;next_run_at:string|null;revision:number}
export function slotView(s:SlotRow,zone?:string) {
  return {id:s.id,agentId:s.agent_id,localTime:s.local_time,daysMask:s.days_mask,leadMinutes:s.lead_minutes,autoPublish:!!s.auto_publish,
    categories:JSON.parse(s.categories_json),enabled:!!s.enabled,position:s.position,nextRunAt:s.next_run_at,
    daysLabel:describeDays(s.days_mask),nextRunLocal:zone&&s.next_run_at?formatInZone(new Date(s.next_run_at),zone):null};
}
export async function listSlots(db:D1Database,id:string) {return (await db.prepare('SELECT * FROM post_slots WHERE agent_id=? ORDER BY position,id').bind(id).all<SlotRow>()).results;}
function fields(b:Record<string,unknown>,prior?:SlotRow) {
  const time=typeof b.localTime==='string'?normalizeHhMm(b.localTime):prior?.local_time??'09:00';
  if(!time)throw new HttpError(400,'Choose a valid posting time.');
  const days=b.daysMask??prior?.days_mask??127,lead=b.leadMinutes??prior?.lead_minutes??15;
  if(typeof days!=='number'||!Number.isInteger(days)||days<1||days>127||typeof lead!=='number'||!Number.isInteger(lead)||lead<10||lead>720)throw new HttpError(400,'Check posting days and review time.');
  for(const key of ['enabled','autoPublish'])if(b[key]!==undefined&&typeof b[key]!=='boolean')throw new HttpError(400,'Check posting settings.');
  const categories=b.categories??JSON.parse(prior?.categories_json??'[]');
  if(!Array.isArray(categories)||categories.length>MAX_SELECTED_CATEGORIES||categories.some(c=>!isCategoryId(c)))throw new HttpError(400,'Choose up to 12 valid subjects.');
  return {time,days,lead,categories:JSON.stringify([...new Set(categories)]),enabled:b.enabled??!!(prior?.enabled??1),auto:b.autoPublish??!!(prior?.auto_publish??0)};
}
export async function slotsRoute(request:Request,db:D1Database,owner:Owner,id?:string) {
  const {settings:agent}=await loadAgent(db,owner.agentId);
  if(request.method==='GET')return json({slots:(await listSlots(db,owner.agentId)).map(s=>slotView(s,agent.timezone)),limits:SLOT_LIMITS,timezone:agent.timezone});
  const existing=await listSlots(db,owner.agentId);
  if(id&&request.method==='DELETE') {
    await db.batch([
      db.prepare(`UPDATE posts SET scheduled_for=NULL,cleared_at=NULL WHERE agent_id=? AND slot_id=? AND status NOT IN ('published','unknown')
        AND NOT EXISTS(SELECT 1 FROM distributions d WHERE d.agent_id=posts.agent_id AND d.seq=posts.seq AND d.status='in_flight')`).bind(owner.agentId,id),
      db.prepare('DELETE FROM post_slots WHERE agent_id=? AND id=?').bind(owner.agentId,id),
    ]);
    return json({ok:true});
  }
  const b=await body(request);
  if(b.action==='count'&&!id) {
    if(typeof b.count!=='number'||!Number.isInteger(b.count)||b.count<1||b.count>5)throw new HttpError(400,'Choose 1–5 posting times.');
    // Keep existing times; disabling excess slots preserves their history.
    const statements:D1PreparedStatement[]=[];
    for(let i=0;i<Math.max(existing.length,b.count);i++) {
      const slot=existing[i];
      if(slot) {
        const enabled=i<b.count;
        statements.push(db.prepare('UPDATE post_slots SET enabled=?,next_run_at=?,revision=revision+1 WHERE id=? AND agent_id=?').bind(enabled?1:0,enabled?nextSlotRun(agent.timezone,slot.local_time,slot.days_mask)!.toISOString():null,slot.id,owner.agentId));
      }else {
        const time=['09:00','12:00','15:00','18:00','20:00'][i];
        statements.push(db.prepare(`INSERT INTO post_slots(agent_id,local_time,days_mask,position,next_run_at)
          SELECT ?,?,127,?,? WHERE (SELECT count(*) FROM post_slots WHERE agent_id=?)<5`).bind(owner.agentId,time,i,nextSlotRun(agent.timezone,time,127)!.toISOString(),owner.agentId));
      }
    }
    await db.batch(statements);
    return json({ok:true,slots:(await listSlots(db,owner.agentId)).map(s=>slotView(s,agent.timezone))});
  }
  const prior=id?existing.find(s=>s.id===id):undefined;
  if(id&&!prior)throw new HttpError(404,'Posting time not found.');
  const f=fields(b,prior);
  const next=f.enabled?nextSlotRun(agent.timezone,f.time,f.days)!.toISOString():null;
  const result=id
    ?await db.prepare(`UPDATE post_slots SET local_time=?,days_mask=?,lead_minutes=?,auto_publish=?,categories_json=?,enabled=?,next_run_at=?,revision=revision+1
      WHERE id=? AND agent_id=? AND revision=? RETURNING *`).bind(f.time,f.days,f.lead,f.auto?1:0,f.categories,f.enabled?1:0,next,id,owner.agentId,prior!.revision).first<SlotRow>()
    :await db.prepare(`INSERT INTO post_slots(agent_id,local_time,days_mask,lead_minutes,auto_publish,categories_json,enabled,next_run_at,position)
      SELECT ?,?,?,?,?,?,?,?,COALESCE(MAX(position),-1)+1 FROM post_slots WHERE agent_id=? HAVING count(*)<5 RETURNING *`)
      .bind(owner.agentId,f.time,f.days,f.lead,f.auto?1:0,f.categories,f.enabled?1:0,next,owner.agentId).first<SlotRow>();
  if(!result)throw new HttpError(409,id?'Posting time changed. Reload and try again.':'You already have five posting times.');
  return json({ok:true,slot:slotView(result,agent.timezone)});
}
export async function timetable(db:D1Database,owner:Owner) {
  const {settings:a}=await loadAgent(db,owner.agentId);
  const today=localClock(a.timezone);
  const slots=(await listSlots(db,a.agentId)).filter(s=>s.enabled&&(s.days_mask&(1<<today.weekday))!==0);
  const runs=(await db.prepare(`SELECT r.* FROM slot_runs r JOIN post_slots s ON s.id=r.slot_id WHERE s.agent_id=? AND r.run_date=?`).bind(a.agentId,today.date).all<{slot_id:string;post_seq:number|null;outcome:string;stage:string|null;retry_at:string;attempts:number;detail:string|null}>()).results;
  const posts=(await db.prepare(`SELECT * FROM posts WHERE agent_id=? AND (slot_date=? OR created_at>? OR scheduled_for>?) ORDER BY seq LIMIT 100`).bind(a.agentId,today.date,new Date(Date.now()-48*3600000).toISOString(),new Date(Date.now()-48*3600000).toISOString()).all<CloudPost & {slot_date:string|null}>()).results;
  const entries=slots.map(s=>{
    const run=runs.find(r=>r.slot_id===s.id),saved=posts.find(p=>p.seq===run?.post_seq||p.slot_id===s.id&&p.slot_date===today.date);
    // Keep the occurrence consumed, but never return a discarded draft as ready.
    const discarded=saved?.status==='rejected',p=discarded?undefined:saved;
    const active=run?.outcome==='pending'&&Date.parse(run.retry_at)>Date.now()-20*60000;
    const completed=Math.max(0,['discovering','judging','writing','saving'].indexOf(run?.stage??''));
    const occurrence=slotOnDate(a.timezone,s.local_time,today.date)!;
    const retryPlanned=!!run&&run.attempts<3&&occurrence.getTime()>Date.now()-45*60000&&s.next_run_at===occurrence.toISOString();
    return {slotId:s.id,time:s.local_time,scheduledFor:occurrence.toISOString(),post:p?postView(p):null,
      progress:p?{state:'ready',stage:'ready',completed:4,total:4}:discarded?{state:'paused',completed:4,total:4,message:'You discarded this draft. Your next posting time is unchanged.'}:active?{state:'working',stage:run?.stage??'discovering',completed,total:4}
        :a.paused?{state:'paused',completed,total:4,message:'Resume ByLine in Settings to prepare posts.'}
        :run?{state:retryPlanned?'waiting':'attention',stage:run.stage,completed,total:4,message:(run.detail??'Preparation did not finish.')+(retryPlanned?' ByLine will retry automatically.':run.attempts>=3?' Automatic attempts have finished for this posting time. You can prepare a separate draft in My posts.':' This posting time has passed. Tap Prepare this post to try again; it will be saved for review.')}:{state:'idle',completed:0,total:4},
      canPrepare:!a.paused&&!p&&!discarded&&!active&&(!run||(run.attempts<3&&Date.parse(run.retry_at)<=Date.now()))};
  }).sort((x,y)=>x.time.localeCompare(y.time));
  const assigned=new Set(entries.flatMap(e=>e.post?[e.post.seq]:[]));
  return {date:today.date,timezone:a.timezone,paused:a.paused,entries,posts:posts.filter(p=>p.status!=='rejected'&&!assigned.has(p.seq)&&localClock(a.timezone,new Date(p.created_at!)).date===today.date).map(postView),total:entries.length,ready:entries.filter(e=>e.post).length};
}
