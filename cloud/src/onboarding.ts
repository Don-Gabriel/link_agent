import { INDUSTRIES,VOICES,defaultSetup,parseSetup,setupCategories,setupPersona,setupStyle,firstDelivery } from '../../lib/setup-config';
import { ALL_CATEGORY_IDS,CATEGORIES,describeCategories } from '../../lib/categories';
import { localClock } from '../../lib/schedule';
import { accountStatus } from './models';
import { generatePreview } from './generation';
import { body,json,HttpError } from './http';
import type { Owner } from './auth';
import type { AppEnv } from './env';
import { generationError } from './generation-errors';
interface SetupRow {config:string;revision:number;preview:string|null;preview_revision:number|null;accepted_revision:number|null;completed_at:string|null;next_delivery_at:string|null;generating_until:string|null}
export async function setupStatus(db:D1Database,owner:Owner) {
  const row=await db.prepare('SELECT config,revision,preview,preview_revision,accepted_revision,completed_at,next_delivery_at,generating_until FROM onboarding WHERE user_id=?').bind(owner.userId).first<SetupRow>();
  if(!row)throw new HttpError(409,'Setup is unavailable. Sign in again.');
  const config={...defaultSetup,...JSON.parse(row.config)};
  const next=row.completed_at?(await db.prepare('SELECT min(next_run_at) AS at FROM post_slots WHERE agent_id=? AND enabled=1').bind(owner.agentId).first<{at:string|null}>())?.at??null:row.next_delivery_at;
  return {...row,config,preview:row.preview?JSON.parse(row.preview):null,next_delivery_at:next,
    nextDeliveryLabel:next?`${localClock(config.timezone,new Date(next)).date} at ${config.time} (${config.timezone})`:null,
    account:await accountStatus(db,owner.agentId),industries:INDUSTRIES,voices:VOICES,categories:ALL_CATEGORY_IDS.map(id=>CATEGORIES[id]),testMode:false};
}
export async function onboardingRoute(request:Request,env:AppEnv,owner:Owner) {
  if(request.method==='GET')return json(await setupStatus(env.DB,owner));
  const b=await body(request),current=await setupStatus(env.DB,owner);
  if(current.completed_at)return json(current);
  if(typeof b.revision!=='number'||!Number.isInteger(b.revision))throw new HttpError(400,'Reload setup and try again.');
  if(b.action==='save') {
    const config=parseSetup(b.config);
    const row=await env.DB.prepare(`UPDATE onboarding SET config=?,revision=revision+1,preview=NULL,preview_revision=NULL,accepted_revision=NULL
      WHERE user_id=? AND revision=? AND completed_at IS NULL RETURNING user_id`).bind(JSON.stringify(config),owner.userId,b.revision).first();
    if(!row)throw new HttpError(409,'Setup changed on another device. Reload and try again.');
  }else if(b.action==='preview') {
    const config=parseSetup(current.config),lease=crypto.randomUUID(),now=new Date(),day=now.toISOString().slice(0,10);
    const acquired=await env.DB.prepare(`UPDATE onboarding SET preview_lease=?,generating_until=?,preview_attempts=CASE WHEN attempts_day=? THEN preview_attempts+1 ELSE 1 END,attempts_day=?
      WHERE user_id=? AND revision=? AND completed_at IS NULL AND (generating_until IS NULL OR generating_until<?)
      AND (attempts_day!=? OR preview_attempts<10) RETURNING revision`)
      .bind(lease,new Date(now.getTime()+3*60000).toISOString(),day,day,owner.userId,b.revision,now.toISOString(),day).first();
    if(!acquired)throw new HttpError(409,'A sample is running, settings changed, or today’s sample allowance was reached.');
    try {
      const sample=await generatePreview(env,owner.userId,owner.name,config);
      await env.DB.prepare(`UPDATE onboarding SET preview=?,preview_revision=?,accepted_revision=NULL WHERE user_id=? AND revision=? AND preview_lease=? AND completed_at IS NULL`)
        .bind(JSON.stringify(sample),b.revision,owner.userId,b.revision,lease).run();
    }catch(error){throw new HttpError(503,generationError(error));}
    finally {await env.DB.prepare('UPDATE onboarding SET generating_until=NULL,preview_lease=NULL WHERE user_id=? AND preview_lease=?').bind(owner.userId,lease).run();}
  }else if(b.action==='accept') {
    const accepted=await env.DB.prepare(`UPDATE onboarding SET accepted_revision=revision WHERE user_id=? AND revision=? AND preview_revision=revision AND preview IS NOT NULL AND generating_until IS NULL RETURNING user_id`).bind(owner.userId,b.revision).first();
    if(!accepted)throw new HttpError(409,'Generate and review a sample for your current voice first.');
  }else if(b.action==='finish') {
    const config=parseSetup({...current.config,time:b.time,timezone:b.timezone,notifications:b.notifications});
    const categories=setupCategories(config),nonce=crypto.randomUUID(),now=new Date().toISOString();
    const next=firstDelivery(config).toISOString();
    const gate='EXISTS(SELECT 1 FROM onboarding WHERE user_id=? AND finish_token=?)';
    const done=await env.DB.batch([
      env.DB.prepare(`UPDATE onboarding SET completed_at=?,config=?,timetable_migrated=1,next_delivery_at=NULL,finish_token=?
        WHERE user_id=? AND revision=? AND accepted_revision=revision AND preview_revision=revision AND generating_until IS NULL AND completed_at IS NULL
        AND EXISTS(SELECT 1 FROM linkedin_accounts WHERE agent_id=? AND expires_at>?) RETURNING user_id`)
        .bind(now,JSON.stringify(config),nonce,owner.userId,b.revision,owner.agentId,now),
      env.DB.prepare(`UPDATE agents SET paused=0,domain=?,categories_json=?,style_json=?,corpus_json=?,persona_json=?,timezone=?,post_time_local=?,revision=revision+1
        WHERE id=? AND ${gate}`).bind(describeCategories(categories),JSON.stringify(categories),JSON.stringify(setupStyle(config)),JSON.stringify(config.samples),JSON.stringify(setupPersona(config,owner.name)),config.timezone,config.time,owner.agentId,owner.userId,nonce),
      env.DB.prepare(`INSERT INTO post_slots(agent_id,local_time,days_mask,lead_minutes,auto_publish,next_run_at) SELECT ?,?,127,15,0,? WHERE ${gate}`)
        .bind(owner.agentId,config.time,next,owner.userId,nonce),
    ]);
    if(!done[0].meta.changes)throw new HttpError(409,'Accept the latest sample and connect LinkedIn before finishing.');
  }else throw new HttpError(400,'Unknown setup action.');
  return json(await setupStatus(env.DB,owner));
}
