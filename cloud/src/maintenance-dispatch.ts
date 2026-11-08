import type {AppEnv} from './env';

/** Keep minute resolution, but don't spend five durable steps when there is no work. */
export async function dispatchMaintenance(env:AppEnv,scheduledTime:number) {
  const at=new Date(scheduledTime),now=at.toISOString(),cleanup=at.getUTCMinutes()===0;
  const due=cleanup?true:await env.DB.prepare(`SELECT 1 AS due WHERE
    EXISTS(SELECT 1 FROM generation_jobs WHERE state='queued' OR (state='working' AND updated_at<?))
    OR EXISTS(SELECT 1 FROM post_slots s JOIN agents a ON a.id=s.agent_id
      WHERE s.enabled=1 AND a.active=1 AND a.paused=0 AND s.next_run_at<=?
      AND s.next_run_at<=strftime('%Y-%m-%dT%H:%M:%fZ',?,printf('+%d minutes',s.lead_minutes+8)))
    OR (?=1 AND EXISTS(SELECT 1 FROM notification_outbox WHERE delivered_at IS NULL AND retry_at<=? AND attempts<5))
    OR (?=1 AND EXISTS(SELECT 1 FROM posts WHERE status IN ('draft','approved','failed') AND scheduled_for<=?))`)
    .bind(new Date(scheduledTime-5*60000).toISOString(),new Date(scheduledTime+728*60000).toISOString(),now,
      env.FCM_SERVICE_ACCOUNT_JSON?1:0,now,env.LINKEDIN_LIVE==='true'?1:0,now).first();
  if(due)await env.MAINTENANCE.createBatch([{id:`minute-${Math.floor(scheduledTime/60000)}`,params:{cleanup}}]);
  // A failed dispatch must not advance the health heartbeat.
  await env.DB.prepare(`INSERT INTO system_status(key,value,updated_at) VALUES('cloud_scheduler','{}',?)
    ON CONFLICT(key) DO UPDATE SET updated_at=excluded.updated_at`).bind(now).run();
  return !!due;
}
