import { query } from './db';
import { localClock } from './schedule';
import { listSlots, type DueSlot } from './slots';
import { migrateTimetable } from './unified-timetable';
import { POST_COLUMNS, serializePost, type PostRow } from './post-view';
import { reviewFeedback } from './review-feedback';

export async function timetableDay(agentId:string, timezone:string, paused:boolean) {
  await migrateTimetable(agentId);
  const clock=localClock(timezone);
  const slots=(await listSlots(agentId)).filter(s=>s.enabled && (s.daysMask & (1<<clock.weekday))!==0)
    .sort((a,b)=>a.localTime.localeCompare(b.localTime));
  const runs=await query<{slot_id:string;post_seq:number|null;outcome:string;stage:string|null;detail:string|null;attempts:number;retry_at:Date;occurrence:Date}>(
    `SELECT s.id AS slot_id,COALESCE(r.post_seq,(SELECT p.seq FROM posts p
       WHERE p.agent_id=s.agent_id AND p.slot_id=s.id AND p.slot_date=$2::date LIMIT 1)) AS post_seq,
      r.outcome,r.stage,r.detail,r.attempts,r.retry_at,
      ($2::date+s.local_time::time) AT TIME ZONE $3 AS occurrence
      FROM post_slots s LEFT JOIN slot_runs r ON r.slot_id=s.id AND r.run_date=$2::date
      WHERE s.agent_id=$1`,[agentId,clock.date,timezone]);
  const seqs=runs.flatMap(r=>r.post_seq===null?[]:[r.post_seq]);
  const posts=await query<PostRow>(`SELECT ${POST_COLUMNS} FROM posts WHERE agent_id=$1 AND
    (seq=ANY($2::int[]) OR to_char(created_at AT TIME ZONE $3,'YYYY-MM-DD')=$4
      OR to_char(scheduled_for AT TIME ZONE $3,'YYYY-MM-DD')=$4) ORDER BY seq`,[agentId,seqs,timezone,clock.date]);
  const entries=slots.map(slot=>{
    const run=runs.find(r=>r.slot_id===slot.id)!;
    const post=posts.find(p=>p.seq===run.post_seq);
    const completed=Math.max(0,['discovering','judging','writing','saving'].indexOf(run.stage??''));
    const active=run.outcome==='pending' && run.retry_at?.getTime()>Date.now()-10*60_000;
    const waiting=!paused && ['failed','silent'].includes(run.outcome) && run.attempts<3 && run.occurrence.getTime()>Date.now();
    const feedback=run.outcome ? reviewFeedback({attempts:waiting?1:3,lease_until:null,retry_at:run.retry_at,
      last_error:run.outcome==='silent'?'below_threshold':run.detail}).body.error : null;
    const progress=post ? {state:'ready',stage:'ready',completed:4,total:4}
      : active ? {state:'working',stage:run.stage??'discovering',completed,total:4}
      : paused ? {state:'paused',completed,total:4,message:'ByLine is paused. Resume it in Timetable to prepare posts.'}
      : run.outcome ? {state:waiting?'waiting':'paused',stage:run.stage,completed,total:4,
          message:run.outcome==='missed'?'This time has passed. Prepare a draft to publish manually, or wait for the next scheduled day.':feedback}
      : {state:'idle',completed:0,total:4};
    return {slotId:slot.id,time:slot.localTime,scheduledFor:run.occurrence.toISOString(),
      post:post?serializePost(post):null,progress,
      canPrepare:!paused && !post && !active && (!run.outcome || run.retry_at.getTime()<=Date.now())};
  });
  const assigned=new Set(entries.flatMap(e=>e.post?[e.post.seq]:[]));
  return {date:clock.date,timezone,paused,entries,posts:posts.filter(p=>!assigned.has(p.seq)).map(serializePost),
    total:entries.length,ready:entries.filter(e=>e.post).length};
}

export async function manualOccurrences(agentId:string,timezone:string,slotIds:string[]):Promise<DueSlot[]> {
  const day=await timetableDay(agentId,timezone,false);
  const slots=await listSlots(agentId);
  return day.entries.filter(e=>e.canPrepare && (!slotIds.length||slotIds.includes(e.slotId))).map(e=>({
    slot:slots.find(s=>s.id===e.slotId)!,timezone,scheduledFor:new Date(e.scheduledFor),runDate:day.date,missed:false,
  }));
}
