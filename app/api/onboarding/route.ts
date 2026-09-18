import { NextResponse } from 'next/server';
import { requestIdentity } from '../../../lib/request-agent';
import { query, getPool } from '../../../lib/db';
import { setupStatus, parseSetup, generateSetupSample, firstDelivery, setupStyle, setupPersona, setupCategories } from '../../../lib/onboarding';
import { describeCategories } from '../../../lib/categories';
import { localTestMode } from '../../../lib/native-auth';
import { withUserUsage } from '../../../lib/ai-usage';
export const dynamic='force-dynamic';
export const maxDuration=120;
export async function GET() {
  const u=await requestIdentity();
  if(!u) return NextResponse.json({error:'unauthorized'},{status:401});
  return NextResponse.json(await setupStatus(u.userId),{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request) {
  const u=await requestIdentity();
  if(!u) return NextResponse.json({error:'unauthorized'},{status:401});
  const b=await request.json().catch(()=>null);
  if(!b) return NextResponse.json({error:'invalid_request'},{status:400});
  try {
    const current=await setupStatus(u.userId);
    if(current.completed_at) return NextResponse.json(current);
    if(b.action==='save') {
      const config=parseSetup(b.config);
      const changed=await query(`UPDATE onboarding SET config=$2,revision=revision+1,preview=NULL,preview_revision=NULL,accepted_revision=NULL
        WHERE user_id=$1 AND revision=$3 AND completed_at IS NULL RETURNING user_id`,[u.userId,JSON.stringify(config),b.revision]);
      if(!changed.length) throw new Error('Setup changed on another device. Reload and try again.');
    } else if(b.action==='preview') {
      if(!localTestMode()&&!current.ai.connected)throw new Error('Connect your Gemini key before preparing a sample.');
      const config=parseSetup(current.config);
      const lease=await query(`UPDATE onboarding SET generating_until=now()+interval '3 minutes',
        preview_attempts=CASE WHEN attempts_day=CURRENT_DATE THEN preview_attempts+1 ELSE 1 END,attempts_day=CURRENT_DATE
        WHERE user_id=$1 AND revision=$2 AND completed_at IS NULL AND (generating_until IS NULL OR generating_until<now())
        AND (attempts_day<>CURRENT_DATE OR preview_attempts<10) RETURNING revision`,[u.userId,b.revision]);
      if(!lease.length) throw new Error('A sample is already running, settings changed, or today’s sample allowance was reached.');
      try {
        const preview=await withUserUsage(u.userId,()=>generateSetupSample(config,u.name));
        await query(`UPDATE onboarding SET preview=$2,preview_revision=$3,accepted_revision=NULL WHERE user_id=$1 AND revision=$3 AND completed_at IS NULL`,[u.userId,JSON.stringify(preview),b.revision]);
      } finally {await query('UPDATE onboarding SET generating_until=NULL WHERE user_id=$1',[u.userId]);}
    } else if(b.action==='accept') {
      const accepted=await query(`UPDATE onboarding SET accepted_revision=revision WHERE user_id=$1 AND revision=$2 AND preview_revision=revision AND preview IS NOT NULL AND generating_until IS NULL RETURNING user_id`,[u.userId,b.revision]);
      if(!accepted.length) throw new Error('Generate and review a sample for your current voice first.');
    } else if(b.action==='finish') {
      if(!localTestMode()&&!current.ai.connected)throw new Error('Connect your Gemini key before finishing setup.');
      const config=parseSetup({...current.config,time:b.time,timezone:b.timezone,notifications:b.notifications});
      if(!localTestMode()&&(!current.account.connected||current.account.needsReauth)) throw new Error('Connect LinkedIn before finishing setup.');
      const next=firstDelivery(config);
      const c=await getPool()!.connect();
      try {
        await c.query('BEGIN');
        const done=await c.query(`UPDATE onboarding SET completed_at=now(),next_delivery_at=$2,config=$3,timetable_migrated=true
          WHERE user_id=$1 AND revision=$4 AND accepted_revision=revision AND preview_revision=revision AND generating_until IS NULL AND completed_at IS NULL RETURNING user_id`,[u.userId,next,JSON.stringify(config),b.revision]);
        if(!done.rowCount) throw new Error('Accept your latest sample before finishing.');
        const categories=setupCategories(config);
        await c.query(`UPDATE agents SET paused=false,domain=$2,categories_json=$3,style_json=$4,corpus_json=$5,persona_json=$6,timezone=$7,post_time_local=$8
          WHERE owner_id=$1`,[u.userId,describeCategories(categories),JSON.stringify(categories),JSON.stringify(setupStyle(config)),JSON.stringify(config.samples),JSON.stringify(setupPersona(config,u.name)),config.timezone,config.time]);
        await c.query(`INSERT INTO post_slots(agent_id,local_time,days_mask,lead_minutes,auto_publish,next_run_at)
          SELECT id,$2,127,15,false,$3 FROM agents WHERE owner_id=$1`,[u.userId,config.time,next]);
        await c.query('UPDATE onboarding SET next_delivery_at=NULL WHERE user_id=$1',[u.userId]);
        await c.query('COMMIT');
      } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
    } else throw new Error('Unknown setup action.');
    return NextResponse.json(await setupStatus(u.userId));
  } catch(e) {return NextResponse.json({error:'setup_failed',detail:(e as Error).message},{status:400});}
}
