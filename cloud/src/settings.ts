import { isCategoryId,MAX_SELECTED_CATEGORIES,describeCategories } from '../../lib/categories';
import { parseStyle,PRESETS } from '../../lib/style';
import { normalizeHhMm,isValidTimeZone,nextSlotRun } from '../../lib/schedule';
import { loadAgent,accountStatus } from './models';
import { listSlots } from './slots';
import { body,json,HttpError } from './http';
import type { Owner } from './auth';

export async function settingsRoute(request:Request,db:D1Database,owner:Owner) {
  const b=await body(request),c=await loadAgent(db,owner.agentId),a=c.settings;
  for(const key of ['paused','autoPublish'])if(b[key]!==undefined&&typeof b[key]!=='boolean')throw new HttpError(400,'Check your publishing preferences.');
  if(b.categories!==undefined&&(!Array.isArray(b.categories)||!b.categories.length||b.categories.length>MAX_SELECTED_CATEGORIES||b.categories.some(v=>!isCategoryId(v))||new Set(b.categories).size!==b.categories.length))throw new HttpError(400,'Choose 1–12 distinct subjects.');
  if(b.timezone!==undefined&&(typeof b.timezone!=='string'||!isValidTimeZone(b.timezone)))throw new HttpError(400,'Choose a valid timezone.');
  if(b.corpus!==undefined&&(!Array.isArray(b.corpus)||b.corpus.length>10||b.corpus.some(t=>typeof t!=='string'||t.trim().length<80||t.trim().length>2400)))throw new HttpError(400,'Use up to 10 writing samples, each 80–2400 characters.');
  if(b.autoPublishCap!==undefined&&(typeof b.autoPublishCap!=='number'||!Number.isInteger(b.autoPublishCap)||b.autoPublishCap<1||b.autoPublishCap>5))throw new HttpError(400,'Choose a daily automatic posting limit from 1–5.');
  const time=b.postTimeLocal===undefined?a.postTimeLocal:typeof b.postTimeLocal==='string'?normalizeHhMm(b.postTimeLocal):null;
  if(!time)throw new HttpError(400,'Choose a valid posting time.');
  if(b.autoPublish===true){const account=await accountStatus(db,a.agentId);if(!account.connected||account.needsReauth)throw new HttpError(409,'Connect LinkedIn before enabling automatic publishing.');}
  const preset=typeof b.preset==='string'?PRESETS[b.preset]:undefined;
  if(b.preset!==undefined&&!preset)throw new HttpError(400,'Choose a valid voice preset.');
  if(b.style!==undefined&&(!b.style||typeof b.style!=='object'||Array.isArray(b.style)))throw new HttpError(400,'Check your writing preferences.');
  const categories=(b.categories??a.categories) as typeof a.categories,zone=(b.timezone??a.timezone) as string;
  const style=parseStyle({...a.style,...preset?.style,...(b.style as object??{})});
  const persona={...c.persona,builtFor:categories,input:{...c.persona.input,domain:describeCategories(categories)}};
  const nonce=crypto.randomUUID();
  const statements=[db.prepare(`UPDATE agents SET categories_json=?,domain=?,timezone=?,post_time_local=?,auto_publish=?,paused=?,auto_publish_cap=?,style_json=?,corpus_json=?,persona_json=?,edit_token=?,revision=revision+1
    WHERE id=? AND revision=? RETURNING id`).bind(JSON.stringify(categories),describeCategories(categories),zone,time,(b.autoPublish??a.autoPublish)?1:0,(b.paused??a.paused)?1:0,
      b.autoPublishCap??a.autoPublishCap,JSON.stringify(style),JSON.stringify(b.corpus??a.corpus),JSON.stringify(persona),nonce,a.agentId,c.row.revision)];
  // A timezone change and its timetable updates commit together and are guarded by the same revision.
  if(zone!==a.timezone)for(const slot of await listSlots(db,a.agentId))statements.push(db.prepare(`UPDATE post_slots SET next_run_at=?,revision=revision+1 WHERE id=? AND agent_id=?
    AND EXISTS(SELECT 1 FROM agents WHERE id=? AND edit_token=?)`).bind(slot.enabled?nextSlotRun(zone,slot.local_time,slot.days_mask)!.toISOString():null,slot.id,a.agentId,a.agentId,nonce));
  statements.push(db.prepare(`UPDATE onboarding SET config=json_set(config,'$.timezone',?) WHERE user_id=? AND EXISTS(SELECT 1 FROM agents WHERE id=? AND edit_token=?)`).bind(zone,owner.userId,a.agentId,nonce));
  const result=await db.batch(statements);
  if(!result[0].meta.changes)throw new HttpError(409,'Settings changed on another device. Reload and try again.');
  return json({ok:true,agent:(await loadAgent(db,a.agentId)).settings});
}
export async function interestsRoute(request:Request,db:D1Database,owner:Owner) {
  if(request.method==='GET'){const c=await loadAgent(db,owner.agentId);return json({topics:c.persona.identity.interests});}
  const b=await body(request),topics=b.topics;
  if(!Array.isArray(topics)||topics.length<1||topics.length>12||topics.some(t=>typeof t!=='string'||t.trim().length<2||t.trim().length>80))throw new HttpError(400,'Add 1–12 topics, each 2–80 characters.');
  const clean=topics.map(t=>t.trim());
  if(new Set(clean.map(t=>t.toLowerCase())).size!==clean.length)throw new HttpError(400,'Each topic should be different.');
  await db.prepare(`UPDATE agents SET persona_json=json_set(persona_json,'$.managed',json('true'),'$.identity.interests',json(?)),revision=revision+1 WHERE id=?`).bind(JSON.stringify(clean),owner.agentId).run();
  return json({ok:true,topics:clean});
}
