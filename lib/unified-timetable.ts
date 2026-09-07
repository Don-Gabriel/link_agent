import { getPool, query } from './db';
import { nextSlotRun } from './schedule';

/** A one-time, transactional handover. Never recreate a user's deleted slots. */
export async function migrateTimetable(agentId?:string) {
  const rows=await query<{id:string}>(`SELECT a.id FROM agents a JOIN onboarding o ON o.user_id=a.owner_id
    WHERE o.completed_at IS NOT NULL AND NOT o.timetable_migrated AND ($1::uuid IS NULL OR a.id=$1)`,[agentId??null]);
  for(const row of rows) {
    const c=await getPool()!.connect();
    try {
      await c.query('BEGIN');
      const locked=await c.query(`SELECT a.id,a.owner_id,a.timezone,a.post_time_local,o.next_delivery_at,o.timetable_migrated
        FROM agents a JOIN onboarding o ON o.user_id=a.owner_id WHERE a.id=$1 FOR UPDATE OF a,o`,[row.id]);
      const a=locked.rows[0];
      if(!a || a.timetable_migrated) {await c.query('COMMIT');continue;}
      let slots=await c.query('SELECT id FROM post_slots WHERE agent_id=$1 ORDER BY position,local_time',[a.id]);
      if(!slots.rowCount) {
        const next=a.next_delivery_at && a.next_delivery_at>new Date() ? a.next_delivery_at
          : nextSlotRun(a.timezone,a.post_time_local,127);
        slots=await c.query(`INSERT INTO post_slots(agent_id,local_time,days_mask,lead_minutes,auto_publish,next_run_at)
          VALUES($1,$2,127,15,false,$3) RETURNING id`,[a.id,a.post_time_local,next]);
      }
      // The existing daily draft occupies the first slot for that day; do not
      // generate a duplicate during migration or change its publish permission.
      const first=slots.rows[0].id;
      await c.query(`INSERT INTO slot_runs(slot_id,run_date,scheduled_for,post_seq,outcome,stage)
        SELECT $2,review_date::date,COALESCE(scheduled_for,created_at),seq,
          CASE WHEN status='published' THEN 'published' ELSE 'drafted' END,'ready'
        FROM posts WHERE agent_id=$1 AND review_date IS NOT NULL
        ON CONFLICT(slot_id,run_date) DO NOTHING`,[a.id,first]);
      await c.query(`UPDATE posts p SET slot_id=$2,slot_date=p.review_date::date FROM slot_runs r
        WHERE p.agent_id=$1 AND p.review_date IS NOT NULL AND p.slot_id IS NULL
          AND r.slot_id=$2 AND r.post_seq=p.seq AND r.run_date=p.review_date::date`,[a.id,first]);
      const covered=await c.query(`SELECT s.* FROM post_slots s JOIN slot_runs r ON r.slot_id=s.id
        AND r.run_date=(s.next_run_at AT TIME ZONE $2)::date WHERE s.agent_id=$1 AND r.post_seq IS NOT NULL`,[a.id,a.timezone]);
      for(const slot of covered.rows)await c.query('UPDATE post_slots SET next_run_at=$2 WHERE id=$1',
        [slot.id,nextSlotRun(a.timezone,slot.local_time,slot.days_mask,new Date(Math.max(Date.now(),slot.next_run_at.getTime())))]);
      await c.query('UPDATE onboarding SET timetable_migrated=true,next_delivery_at=NULL WHERE user_id=$1',[a.owner_id]);
      await c.query(`UPDATE agents SET auto_publish_cap=GREATEST(1,LEAST(5,
        (SELECT count(*) FROM post_slots WHERE agent_id=$1 AND enabled))) WHERE id=$1`,[a.id]);
      await c.query('COMMIT');
    } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
  }
}
