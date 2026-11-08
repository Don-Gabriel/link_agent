import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {provisionIdentity} from '../src/identities';
import {signSession} from '../src/crypto';
import {defaultSetup} from '../../lib/setup-config';
import {saveDraft} from '../src/drafts';
import {publish,resolveSend} from '../src/publish';
import {encryptToken} from '../src/crypto';
import type {AppEnv} from '../src/env';
import {slotOnDate,localClock} from '../../lib/schedule';

const secret='test-api-session-secret-at-least-32-characters';
const runtime=new Miniflare(convertV4MiniflareOptions({
  modules:true,scriptPath:fileURLToPath(new URL('../.wrangler/test-build/index.js',import.meta.url)),
  compatibilityDate:'2026-10-27',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
  workflows:{CONTENT:{name:'byline-content',className:'ContentWorkflow'},MAINTENANCE:{name:'byline-maintenance',className:'MaintenanceWorkflow'}},
  bindings:{APP_SECRET:secret,TOKEN_ENCRYPTION_KEY:'b'.repeat(64),LINKEDIN_CLIENT_ID:'test-id',LINKEDIN_CLIENT_SECRET:'test-secret'},
}));
let db:Awaited<ReturnType<typeof runtime.getD1Database>>;
before(async()=>{
  db=await runtime.getD1Database('DB');
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()) {
    const sql=readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8');
    await db.batch(sql.replace(/^--.*$/gm,'').split(/;\s*(?=CREATE|ALTER|$)/).map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
  }
});
after(()=>runtime.dispose());
async function author(name:string) {
  const a=await provisionIdentity(db,{provider:'linkedin',subject:name,name}),id=crypto.randomUUID(),expires=Date.now()+86400000;
  await db.prepare('INSERT INTO byline_sessions(id,user_id,expires_at) VALUES(?,?,?)').bind(id,a.userId,new Date(expires).toISOString()).run();
  return {...a,token:await signSession(secret,a.userId,id,expires)};
}
async function call(token:string,path:string,method='GET',payload?:unknown) {
  return runtime.dispatchFetch(`https://byline.example${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
}

test('AI allowance reads are authenticated and owner-bound; clients cannot assign their own plan',async()=>{
  const a=await author('allowance-owner'),b=await author('allowance-other');
  await db.prepare("INSERT INTO ai_account_limits(owner,plan_key,daily_attempt_limit) VALUES(?,'internal-test-plan',7)").bind(a.userId).run();
  assert.equal((await runtime.dispatchFetch('https://byline.example/api/ai/usage')).status,401);
  const own=await (await call(a.token,'/api/ai/usage')).json() as {plan:string;limit:number};
  assert.equal(own.plan,'internal-test-plan');assert.equal(own.limit,7);
  const other=await (await call(b.token,`/api/ai/usage?owner=${a.userId}`)).json() as {plan:string;limit:number};
  assert.equal(other.plan,'pilot');assert.equal(other.limit,40);
  assert.equal((await call(b.token,'/api/ai/usage','POST',{owner:a.userId,plan:'unlimited',daily_attempt_limit:99999})).status,404);
  assert.equal((await db.prepare('SELECT daily_attempt_limit FROM ai_account_limits WHERE owner=?').bind(a.userId).first())?.daily_attempt_limit,7);
});

test('timezone changes move prepared timetable drafts, revoke approvals and preserve custom times',async()=>{
  const a=await author('prepared-timezone');
  const slot=(await (await call(a.token,'/api/slots','POST',{localTime:'09:00'})).json() as {slot:{id:string}}).slot;
  const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10),old=slotOnDate('UTC','09:00',date)!.toISOString();
  const seq=await saveDraft(db,{agentId:a.agentId,requestId:'prepared-zone',text:'A prepared timetable draft.',rationale:'test',fingerprint:'timezone',sources:[],slotId:slot.id,slotDate:date,scheduledFor:old,cleared:true});
  await db.prepare("INSERT INTO slot_runs(slot_id,run_date,scheduled_for,post_seq,outcome) VALUES(?,?,?,?,'drafted')").bind(slot.id,date,old,seq).run();
  await db.prepare('INSERT INTO notification_outbox(agent_id,payload,dedupe_key,retry_at) VALUES(?,?,?,?)').bind(a.agentId,JSON.stringify({kind:'draft_ready',seq}),`draft:${a.agentId}:${seq}`,old).run();
  const custom=await saveDraft(db,{agentId:a.agentId,requestId:'custom-zone',text:'A custom scheduled draft.',rationale:'test',fingerprint:'custom',sources:[],scheduledFor:old,cleared:true});
  const change=await call(a.token,'/api/settings','PATCH',{timezone:'Asia/Kathmandu'});assert.equal(change.status,200);
  const p=await db.prepare('SELECT scheduled_for,cleared_at FROM posts WHERE agent_id=? AND seq=?').bind(a.agentId,seq).first();
  assert.equal(p!.scheduled_for,slotOnDate('Asia/Kathmandu','09:00',date)!.toISOString());assert.equal(p!.cleared_at,null);
  assert.equal((await db.prepare('SELECT scheduled_for FROM slot_runs WHERE slot_id=?').bind(slot.id).first())?.scheduled_for,p!.scheduled_for);
  assert.equal((await db.prepare('SELECT retry_at FROM notification_outbox WHERE dedupe_key=?').bind(`draft:${a.agentId}:${seq}`).first())?.retry_at,new Date(Date.parse(String(p!.scheduled_for))-15*60000).toISOString());
  const c=await db.prepare('SELECT scheduled_for,cleared_at FROM posts WHERE agent_id=? AND seq=?').bind(a.agentId,custom).first();
  assert.equal(c!.scheduled_for,old);assert.ok(c!.cleared_at);
});

test('today’s timetable uses its exact local date and never promises a retry for an expired occurrence',async()=>{
  const a=await author('expired-preparation');
  await db.prepare('UPDATE agents SET timezone=?,paused=0 WHERE id=?').bind('Pacific/Kiritimati',a.agentId).run();
  const slot=(await (await call(a.token,'/api/slots','POST',{localTime:'00:00'})).json() as {slot:{id:string}}).slot;
  const date=localClock('Pacific/Kiritimati').date,at=slotOnDate('Pacific/Kiritimati','00:00',date)!.toISOString();
  await db.prepare("INSERT INTO slot_runs(slot_id,run_date,scheduled_for,outcome,attempts,retry_at,detail) VALUES(?,?,?,'failed',1,'2020-01-01T00:00:00.000Z','Preparation stopped.')").bind(slot.id,date,at).run();
  const day=await (await call(a.token,'/api/review-delivery')).json() as {date:string;entries:{scheduledFor:string;progress:{state:string};canPrepare:boolean}[]};
  assert.equal(day.date,date);assert.equal(day.entries[0].scheduledFor,at);assert.equal(day.entries[0].progress.state,'attention');assert.equal(day.entries[0].canPrepare,true);
});

test('style review blocks automatic sends until explicit approval; timezone dates govern daily sends',async()=>{
  const a=await author('quality-hold'),env=await runtime.getBindings<AppEnv>();env.DB=db;env.LINKEDIN_LIVE='true';
  await db.prepare("UPDATE agents SET paused=0,auto_publish=1,timezone='Pacific/Kiritimati' WHERE id=?").bind(a.agentId).run();
  const slot=(await (await call(a.token,'/api/slots','POST',{localTime:'09:00',autoPublish:true})).json() as {slot:{id:string}}).slot;
  await db.prepare('INSERT INTO linkedin_accounts(agent_id,member_urn,access_token_enc,expires_at) VALUES(?,?,?,?)').bind(a.agentId,'urn:li:person:test',await encryptToken(env.TOKEN_ENCRYPTION_KEY,'test'),'2099-01-01T00:00:00.000Z').run();
  const at=new Date(Date.now()-1000).toISOString();
  const seq=await saveDraft(db,{agentId:a.agentId,requestId:'quality-held',text:'A saved draft for a human to review.',rationale:'test',fingerprint:'quality',sources:[],slotId:slot.id,slotDate:localClock('Pacific/Kiritimati').date,scheduledFor:at,reviewNotes:['Check the word count.']});
  const original=globalThis.fetch;let sent=0;
  globalThis.fetch=async()=>{sent++;return new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:test'}});};
  try {
    await assert.rejects(publish(env,a.agentId,seq,'auto'));assert.equal(sent,0);
    const status=await (await call(a.token,'/api/status')).json() as {queue:{reviewNotes:string[]}[]};assert.deepEqual(status.queue[0].reviewNotes,['Check the word count.']);
    assert.equal((await call(a.token,`/api/posts/${seq}`,'PATCH',{action:'clear',reviewed:{text:'A saved draft for a human to review.',hashtags:[],media:[]}})).status,200);
    await db.prepare('UPDATE posts SET scheduled_for=? WHERE agent_id=? AND seq=?').bind(new Date(Date.now()+60000).toISOString(),a.agentId,seq).run();
    await assert.rejects(publish(env,a.agentId,seq,'auto'));assert.equal(sent,0);
    await db.prepare('UPDATE posts SET scheduled_for=? WHERE agent_id=? AND seq=?').bind(at,a.agentId,seq).run();
    assert.equal((await call(a.token,`/api/posts/${seq}`,'PATCH',{action:'unclear'})).status,200);
    // Even a perfect draft must not bypass the author's Undo via slot auto-publish.
    await db.prepare("UPDATE posts SET review_notes_json='[]' WHERE agent_id=? AND seq=?").bind(a.agentId,seq).run();
    await assert.rejects(publish(env,a.agentId,seq,'auto'));assert.equal(sent,0);
    assert.equal((await call(a.token,`/api/posts/${seq}`,'PATCH',{action:'clear'})).status,200);
    assert.equal((await publish(env,a.agentId,seq,'auto')).ok,true);assert.equal(sent,1);
    assert.equal((await db.prepare('SELECT send_day FROM distributions WHERE agent_id=?').bind(a.agentId).first())?.send_day,localClock('Pacific/Kiritimati').date);
  }finally{globalThis.fetch=original;}
});

test('status exposes only the owner’s latest job and saved notification preference',async()=>{
  const a=await author('job-owner'),b=await author('other-job-owner');
  await db.prepare('UPDATE onboarding SET config=? WHERE user_id=?').bind(JSON.stringify({...defaultSetup,notifications:'enabled'}),a.userId).run();
  await db.prepare("INSERT INTO generation_jobs(id,agent_id,payload,state,error) VALUES('own-job',?,'{}','failed','Draft needs another pass')").bind(a.agentId).run();
  await db.prepare("INSERT INTO generation_jobs(id,agent_id,payload,state) VALUES('other-job',?,'{}','working')").bind(b.agentId).run();
  const status=await (await call(a.token,'/api/status')).json() as {generation:{id:string;state:string;error:string};reviewDelivery:{config:{notifications:string}}};
  assert.equal(status.generation.id,'own-job');
  assert.equal(status.generation.state,'failed');
  assert.equal(status.generation.error,'Draft needs another pass');
  assert.equal(status.reviewDelivery.config.notifications,'enabled');
});
test('the compiled Worker responds to health and rejects protected routes without a session',async()=>{
  const health=await runtime.dispatchFetch('https://byline.example/api/health');
  assert.equal(health.status,200);assert.equal((await health.json() as {ok:boolean}).ok,true);
  for(const path of ['/api/status','/api/posts','/api/onboarding','/api/slots','/api/interests'])assert.equal((await runtime.dispatchFetch(`https://byline.example${path}`)).status,401);
});

test('scheduler monitoring reports missing and stale heartbeats as unavailable',async()=>{
  const url='https://byline.example/api/health?check=scheduler';
  assert.equal((await runtime.dispatchFetch(url)).status,503);
  await db.prepare("INSERT INTO system_status(key,value,updated_at) VALUES('cloud_scheduler','{}',?)").bind(new Date().toISOString()).run();
  assert.equal((await runtime.dispatchFetch(url)).status,200);
  await db.prepare("UPDATE system_status SET updated_at='2020-01-01T00:00:00.000Z' WHERE key='cloud_scheduler'").run();
  assert.equal((await runtime.dispatchFetch(url)).status,503);
});
test('mobile setup, status and timetable contracts work in the Workers runtime',async()=>{
  const a=await author('contract-author');
  const setup=await call(a.token,'/api/onboarding');assert.equal(setup.status,200);
  const data=await setup.json() as {revision:number;categories:unknown[];testMode:boolean};
  assert.equal(data.testMode,false);assert.ok(data.categories.length>1000);
  const save=await call(a.token,'/api/onboarding','POST',{action:'save',revision:data.revision,config:defaultSetup});assert.equal(save.status,200);
  assert.equal((await call(a.token,'/api/onboarding','POST',{action:'save',revision:data.revision,config:defaultSetup})).status,409);
  const status=await call(a.token,'/api/status');assert.equal(status.status,200);
  const s=await status.json() as {initialized:boolean;scheduler:{healthy:boolean};agent:{paused:boolean}};
  assert.equal(s.initialized,true);assert.equal(s.agent.paused,true);assert.equal(s.scheduler.healthy,false);
  assert.equal((await call(a.token,'/api/review-delivery')).status,200);
});
test('concurrent composer saves stay idempotent; another account cannot read or edit the draft',async()=>{
  const a=await author('composer-author'),b=await author('other-author');
  const input={text:'A real draft with enough words to save in the author’s archive.',hashtags:[],mediaIds:[],clientRequestId:'same-request-with-20-characters'};
  const results=await Promise.all(Array.from({length:5},()=>call(a.token,'/api/posts','POST',input)));
  for(const r of results)assert.equal(r.status,200);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM posts WHERE agent_id=?').bind(a.agentId).first())?.n,1);
  assert.equal((await call(b.token,'/api/posts/1','PATCH',{action:'edit',text:'An attempt to overwrite a different account’s post.'})).status,404);
  assert.equal((await call(a.token,'/api/posts','POST',{...input,text:'Changed text for a request that already succeeded.'})).status,409);
  const edited=await call(a.token,'/api/posts/1','PATCH',{action:'edit',text:'This is the edited version, explicitly saved by its author.',hashtags:[]});assert.equal(edited.status,200);
  await db.prepare("INSERT INTO distributions(agent_id,seq,idempotency_key,status) VALUES(?,1,?,'in_flight')").bind(a.agentId,`in-flight:${a.agentId}`).run();
  assert.equal((await call(a.token,'/api/posts/1','PATCH',{action:'discard'})).status,409);
  const remove=await call(a.token,'/api/account/delete','POST',{confirmation:'DELETE'});assert.equal(remove.status,409);
  assert.ok(await db.prepare('SELECT id FROM byline_users WHERE id=?').bind(a.userId).first());
  assert.ok(await db.prepare('SELECT seq FROM posts WHERE agent_id=?').bind(a.agentId).first());
});
test('discard removes manual and timetable drafts from every feed without affecting another author',async()=>{
  const a=await author('discard-owner'),b=await author('discard-other');
  await call(a.token,'/api/settings','PATCH',{paused:false});
  const slot=(await (await call(a.token,'/api/slots','POST',{localTime:'09:00',daysMask:127})).json() as {slot:{id:string}}).slot;
  const day=(await (await call(a.token,'/api/review-delivery')).json() as {date:string}).date;
  const input={text:'A draft that its author can choose to discard.',rationale:'test',fingerprint:'discard-test',sources:[]};
  const manual=await saveDraft(db,{...input,agentId:a.agentId,requestId:'manual-discard'});
  const scheduled=await saveDraft(db,{...input,agentId:a.agentId,requestId:'scheduled-discard',slotId:slot.id,slotDate:day});
  await db.prepare("INSERT INTO slot_runs(slot_id,run_date,scheduled_for,post_seq,outcome) VALUES(?,?,?,?,'drafted')").bind(slot.id,day,new Date().toISOString(),scheduled).run();
  await saveDraft(db,{...input,agentId:b.agentId,requestId:'other-author'});
  const before=await (await call(a.token,'/api/review-delivery')).json() as any;
  assert.equal(before.posts[0].seq,manual);assert.equal(before.entries[0].post.seq,scheduled);
  for(const seq of [manual,scheduled])assert.equal((await call(a.token,`/api/posts/${seq}`,'PATCH',{action:'discard'})).status,200);
  for(let reload=0;reload<2;reload++) {
    const home=await (await call(a.token,'/api/review-delivery')).json() as any;
    assert.deepEqual(home.posts,[]);assert.deepEqual(home.entries,[]);
    assert.equal(home.ready,0);
    assert.deepEqual((await (await call(a.token,'/api/status')).json() as any).timeline,[]);
    assert.deepEqual((await (await call(a.token,'/api/status')).json() as any).queue,[]);
  }
  assert.equal((await (await call(b.token,'/api/status')).json() as any).queue.length,1);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM posts WHERE agent_id=? AND status='rejected'").bind(a.agentId).first())?.n,2);
});

test('timetable bounds and schedule updates are enforced by the database',async()=>{
  const a=await author('slots-author');
  const results=await Promise.all(Array.from({length:8},(_,i)=>call(a.token,'/api/slots','POST',{localTime:`${String(9+i).padStart(2,'0')}:00`,daysMask:127,leadMinutes:15})));
  assert.equal(results.filter(r=>r.status===200).length,5);assert.equal(results.filter(r=>r.status===409).length,3);
  const settings=await call(a.token,'/api/settings','PATCH',{timezone:'Asia/Kolkata',paused:true});assert.equal(settings.status,200);
  const list=await (await call(a.token,'/api/slots')).json() as {slots:{id:string;nextRunAt:string}[];timezone:string};
  assert.equal(list.timezone,'Asia/Kolkata');assert.equal(list.slots.length,5);
  const first=list.slots[0];assert.equal((await call(a.token,`/api/slots/${first.id}`,'PATCH',{localTime:'25:88'})).status,400);
});
test('two authors keep drafts, schedules, settings and notification devices isolated',async()=>{
  const a=await author('isolation-a'),b=await author('isolation-b');
  const [sa,sb]=await Promise.all([call(a.token,'/api/slots','POST',{localTime:'09:00'}),call(b.token,'/api/slots','POST',{localTime:'18:00'})]);
  const slotA=(await sa.json() as {slot:{id:string}}).slot.id;
  const slotB=(await sb.json() as {slot:{id:string}}).slot.id;
  assert.notEqual(slotA,slotB);
  assert.equal((await call(b.token,`/api/slots/${slotA}`,'PATCH',{localTime:'12:00'})).status,404);
  await call(b.token,`/api/slots/${slotA}`,'DELETE');
  assert.ok(await db.prepare('SELECT id FROM post_slots WHERE id=?').bind(slotA).first());
  await call(a.token,'/api/settings','PATCH',{timezone:'Asia/Kolkata'});
  assert.equal((await (await call(b.token,'/api/slots')).json() as {timezone:string}).timezone,'UTC');
  const input={text:'Private draft belonging to this specific author.',clientRequestId:'shared-request-id-123456'};
  const saved=await Promise.all([call(a.token,'/api/posts','POST',input),call(b.token,'/api/posts','POST',{...input,text:'A different private draft belonging to the second author.'})]);
  for(const r of saved)assert.equal(r.status,200);
  await call(a.token,'/api/posts/1','PATCH',{action:'edit',text:'Only the first author changed this particular draft.'});
  assert.equal((await db.prepare('SELECT text FROM posts WHERE agent_id=? AND seq=1').bind(b.agentId).first())?.text,'A different private draft belonging to the second author.');
  const device='test-device-token-shared-phone-123';
  await call(a.token,'/api/devices','POST',{token:device});
  await call(b.token,'/api/devices','DELETE',{token:device});
  assert.equal((await db.prepare('SELECT agent_id FROM device_tokens WHERE token=?').bind(device).first())?.agent_id,a.agentId);
  // Account switching reassigns this phone; a late logout cannot unregister its new owner.
  await call(b.token,'/api/devices','POST',{token:device});
  await call(a.token,'/api/devices','DELETE',{token:device});
  assert.equal((await db.prepare('SELECT agent_id FROM device_tokens WHERE token=?').bind(device).first())?.agent_id,b.agentId);
  assert.equal((await call(b.token,`/api/devices?token=${device}`,'DELETE')).status,200);
  assert.equal(await db.prepare('SELECT agent_id FROM device_tokens WHERE token=?').bind(device).first(),null);
  await call(a.token,'/api/auth','DELETE');
  assert.equal((await call(a.token,'/api/status')).status,401);
  assert.equal((await call(b.token,'/api/status')).status,200);
});

test('onboarding finish is atomic and duplicate requests cannot create two first slots',async()=>{
  const a=await author('finish-author');
  await db.prepare(`UPDATE onboarding SET config=?,preview=?,revision=1,preview_revision=1,accepted_revision=1 WHERE user_id=?`).bind(JSON.stringify(defaultSetup),JSON.stringify({text:'An accepted sample.',sources:[],testMode:false}),a.userId).run();
  const payload={action:'finish',revision:1,time:'09:30',timezone:'Asia/Kolkata',notifications:'later'};
  assert.equal((await call(a.token,'/api/onboarding','POST',payload)).status,409);
  assert.equal((await db.prepare('SELECT paused FROM agents WHERE id=?').bind(a.agentId).first())?.paused,1);
  await db.prepare('INSERT INTO linkedin_accounts(agent_id,member_urn,access_token_enc,expires_at) VALUES(?,?,?,?)').bind(a.agentId,'urn:li:person:test','not-a-real-token','2099-01-01T00:00:00.000Z').run();
  const results=await Promise.all(Array.from({length:4},()=>call(a.token,'/api/onboarding','POST',payload)));
  assert.ok(results.some(r=>r.status===200));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM post_slots WHERE agent_id=?').bind(a.agentId).first())?.n,1);
  assert.equal((await db.prepare('SELECT paused FROM agents WHERE id=?').bind(a.agentId).first())?.paused,0);
});
test('deleting an idle account removes only that account and revokes its session',async()=>{
  const a=await author('delete-author'),b=await author('preserved-author');
  await saveDraft(db,{agentId:a.agentId,requestId:'delete-draft',text:'A draft to remove.',rationale:'Test',fingerprint:'test',sources:[]});
  assert.equal((await call(a.token,'/api/account/delete','POST',{confirmation:'DELETE'})).status,200);
  assert.equal(await db.prepare('SELECT id FROM byline_users WHERE id=?').bind(a.userId).first(),null);
  assert.ok(await db.prepare('SELECT id FROM byline_users WHERE id=?').bind(b.userId).first());
  assert.equal((await call(a.token,'/api/status')).status,401);
});

test('parallel publishers make one provider request and unknown outcomes cannot be retried',async()=>{
  const a=await author('publish-author'),env=await runtime.getBindings<AppEnv>();
  env.LINKEDIN_LIVE='true';env.DB=db;
  await db.prepare('INSERT INTO linkedin_accounts(agent_id,member_urn,access_token_enc,expires_at) VALUES(?,?,?,?)').bind(a.agentId,'urn:li:person:publisher',await encryptToken(env.TOKEN_ENCRYPTION_KEY,'test-provider-token'),'2099-01-01T00:00:00.000Z').run();
  const draft={agentId:a.agentId,requestId:'publish-once',text:'A post that can be published only once.',rationale:'test',fingerprint:'test',sources:[]};
  const seq=await saveDraft(db,draft),original=globalThis.fetch;let sends=0;
  globalThis.fetch=async url=>{assert.equal(String(url),'https://api.linkedin.com/rest/posts');sends++;return new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:123'}});};
  try {
    const results=await Promise.allSettled(Array.from({length:6},()=>publish(env,a.agentId,seq)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(sends,1);
    const second=await saveDraft(db,{...draft,requestId:'unknown-send'});
    globalThis.fetch=async()=>{sends++;return new Response('Provider unavailable',{status:503});};
    const result=await publish(env,a.agentId,second);assert.equal(result.ok,false);assert.equal(result.ambiguous,true);
    await assert.rejects(publish(env,a.agentId,second));assert.equal(sends,2);
    await resolveSend(db,a.agentId,second,false);
    assert.equal((await db.prepare('SELECT status FROM posts WHERE agent_id=? AND seq=?').bind(a.agentId,second).first())?.status,'draft');
    await assert.rejects(resolveSend(db,a.agentId,second,true));
    assert.equal((await db.prepare('SELECT status FROM posts WHERE agent_id=? AND seq=?').bind(a.agentId,second).first())?.status,'draft');
  }finally {globalThis.fetch=original;}
});
