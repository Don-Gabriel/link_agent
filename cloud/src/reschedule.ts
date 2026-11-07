import {slotOnDate} from '../../lib/schedule';

/** Move only unconsumed timetable drafts, never published or individually rescheduled posts.
 * The caller adds these statements to its revision-guarded settings transaction.
 */
export async function rescheduleSlotDrafts(db:D1Database,agentId:string,slotId:string,zone:string,time:string,enabled:boolean,leadMinutes:number,guard:string,guardArgs:unknown[]) {
  const rows=(await db.prepare(`SELECT p.seq,p.slot_date,p.scheduled_for FROM posts p JOIN slot_runs r
    ON r.slot_id=p.slot_id AND r.run_date=p.slot_date AND r.post_seq=p.seq
    WHERE p.agent_id=? AND p.slot_id=? AND p.scheduled_for=r.scheduled_for AND p.scheduled_for>?
      AND p.status IN ('draft','approved','failed')`).bind(agentId,slotId,new Date().toISOString()).all<{seq:number;slot_date:string;scheduled_for:string}>()).results;
  const statements:D1PreparedStatement[]=[];
  for(const p of rows) {
    const at=enabled?slotOnDate(zone,time,p.slot_date):null;
    const next=at&&at.getTime()>Date.now()?at.toISOString():null;
    // A new time already in the past becomes an unscheduled draft, never an immediate send.
    statements.push(db.prepare(`UPDATE posts SET scheduled_for=?,cleared_at=NULL,requires_review=1,status='draft'
      WHERE agent_id=? AND seq=? AND scheduled_for=? AND status IN ('draft','approved','failed') AND ${guard}
      AND NOT EXISTS(SELECT 1 FROM distributions d WHERE d.agent_id=posts.agent_id AND d.seq=posts.seq AND d.status IN ('in_flight','sent','unknown'))`)
      .bind(next,agentId,p.seq,p.scheduled_for,...guardArgs));
    if(next)statements.push(db.prepare(`UPDATE slot_runs SET scheduled_for=? WHERE slot_id=? AND run_date=? AND post_seq=? AND ${guard}
      AND EXISTS(SELECT 1 FROM posts WHERE agent_id=? AND seq=? AND scheduled_for=?)`)
      .bind(next,slotId,p.slot_date,p.seq,...guardArgs,agentId,p.seq,next));
    statements.push(db.prepare(`UPDATE notification_outbox SET retry_at=? WHERE agent_id=? AND dedupe_key=? AND delivered_at IS NULL AND attempts=0 AND ${guard}
      AND EXISTS(SELECT 1 FROM posts WHERE agent_id=? AND seq=? AND scheduled_for IS ?)`)
      .bind(new Date(Math.max(Date.now(),next?Date.parse(next)-leadMinutes*60000:0)).toISOString(),agentId,`draft:${agentId}:${p.seq}`,...guardArgs,agentId,p.seq,next));
  }
  return statements;
}
