/** Durable daily review delivery; advanced fixed-time posting still uses slots. */
import { query } from './db';
import { runCycleWithLock } from './cycle';
import { localTestMode } from './native-auth';
import { generateSetupSample, type SetupConfig } from './onboarding';
import { localClock, nextDailyRun } from './schedule';
import { notify, type PushEvent } from './push';

export async function runDueReviews(agentId?:string) {
  const due=await query<{id:string;owner_id:string;config:SetupConfig;next_delivery_at:string}>(
    `SELECT a.id,a.owner_id,o.config,o.next_delivery_at::text AS next_delivery_at FROM agents a JOIN onboarding o ON o.user_id=a.owner_id
      WHERE a.active AND NOT a.paused AND o.completed_at IS NOT NULL AND NOT o.timetable_migrated AND o.next_delivery_at<=now()+interval '15 minutes'
      AND ($1::uuid IS NULL OR a.id=$1)
      ORDER BY o.next_delivery_at LIMIT 5`,[agentId??null]);
  for(const d of due) {
    const day=localClock(d.config.timezone,new Date(d.next_delivery_at)).date;
    await query(`INSERT INTO review_deliveries(agent_id,delivery_date) VALUES($1,$2) ON CONFLICT DO NOTHING`,[d.id,day]);
    const lease=await query(`UPDATE review_deliveries SET lease_until=now()+interval '10 minutes',attempts=attempts+1,stage='discovering',last_error=NULL
      WHERE agent_id=$1 AND delivery_date=$2 AND seq IS NULL AND attempts<3 AND retry_at<=now()
      AND (lease_until IS NULL OR lease_until<now()) RETURNING agent_id`,[d.id,day]);
    if(!lease.length)continue;
    try {
      let [post]=await query<{seq:number;text:string}>('SELECT seq,text FROM posts WHERE agent_id=$1 AND review_date=$2',[d.id,day]);
      if(!post) {
        if(localTestMode()) {
          const sample=await generateSetupSample(d.config);
          [post]=await query<{seq:number;text:string}>(`INSERT INTO posts(agent_id,seq,text,rationale,sources_json,fingerprint,status,kind,review_date)
            VALUES($1,byline_next_seq($1),$2,'Local demonstration; no AI call',$3,$4,'draft','auto',$5)
            ON CONFLICT(agent_id,review_date) WHERE review_date IS NOT NULL DO UPDATE SET review_date=EXCLUDED.review_date RETURNING seq,text`,
            [d.id,sample.text,JSON.stringify(sample.sources),`local-review:${day}`,day]);
        } else {
          const result=await runCycleWithLock(d.id,true,{reviewDate:day,suppressNotification:true,
            onProgress: async stage => {
              await query('UPDATE review_deliveries SET stage=$3 WHERE agent_id=$1 AND delivery_date=$2 AND seq IS NULL',[d.id,day,stage]);
            }});
          [post]=await query<{seq:number;text:string}>('SELECT seq,text FROM posts WHERE agent_id=$1 AND review_date=$2',[d.id,day]);
          // Preserve the cause instead of turning every quiet day, provider
          // failure and competing worker into the same misleading error.
          if(!post)throw new Error(result.skippedReason ?? 'preparation_failed');
        }
      }
      const event:PushEvent={kind:'draft_ready',seq:post.seq,hook:post.text.slice(0,160),at:null};
      await query(`INSERT INTO notification_outbox(agent_id,payload,dedupe_key,retry_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[d.id,JSON.stringify(event),`${d.id}:${day}`,d.next_delivery_at]);
      await query(`UPDATE review_deliveries SET seq=$3,lease_until=NULL,last_error=NULL,stage='ready' WHERE agent_id=$1 AND delivery_date=$2`,[d.id,day,post.seq]);
      await advance(d.owner_id,d.config,d.next_delivery_at);
    }catch(e) {
      await query(`UPDATE review_deliveries SET lease_until=NULL,retry_at=now()+interval '10 minutes',last_error=$3 WHERE agent_id=$1 AND delivery_date=$2`,[d.id,day,(e as Error).message.slice(0,250)]);
    }
  }
  // A completed row or exhausted retry survives a crash between settling and advancing.
  const settled=await query<{owner_id:string;config:SetupConfig;next_delivery_at:string}>(
    `SELECT a.owner_id,o.config,o.next_delivery_at::text AS next_delivery_at FROM onboarding o JOIN agents a ON a.owner_id=o.user_id
      JOIN review_deliveries r ON r.agent_id=a.id AND r.delivery_date=to_char(o.next_delivery_at AT TIME ZONE a.timezone,'YYYY-MM-DD')
      WHERE (r.seq IS NOT NULL OR r.attempts>=3) AND (r.lease_until IS NULL OR r.lease_until<now()) AND o.next_delivery_at<=now()+interval '15 minutes'
      AND ($1::uuid IS NULL OR a.id=$1)`,[agentId??null]);
  for(const s of settled)await advance(s.owner_id,s.config,s.next_delivery_at);
}
// Keep the database timestamp text: JS Date drops PostgreSQL microseconds,
// making an exact compare-and-swap silently match zero rows.
async function advance(userId:string,config:SetupConfig,previous:string) {
  const next=nextDailyRun(config.timezone,config.time,new Date(Math.max(Date.now(),new Date(previous).getTime())));
  await query(`UPDATE onboarding SET next_delivery_at=$2 WHERE user_id=$1 AND next_delivery_at=$3`,[userId,next,previous]);
}
export async function flushNotifications() {
  const pending=await query<{id:string;agent_id:string;payload:PushEvent}>(
    `UPDATE notification_outbox SET retry_at=now()+interval '5 minutes',attempts=attempts+1
      WHERE id IN(SELECT id FROM notification_outbox WHERE delivered_at IS NULL AND retry_at<=now() AND attempts<12 ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED)
      RETURNING id,agent_id,payload`);
  for(const p of pending)if(await notify(p.agent_id,p.payload)>0)
    await query('UPDATE notification_outbox SET delivered_at=now() WHERE id=$1',[p.id]);
}
