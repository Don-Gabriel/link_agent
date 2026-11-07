import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { provisionIdentity, sessionOwner } from '../src/identities.ts';
import { saveDraft } from '../src/drafts.ts';
import { reserveAi } from '../src/ai.ts';
import { nativeAuth, authCallback, authenticate } from '../src/auth.ts';
import { signSession, verifySession, encryptToken, decryptToken } from '../src/crypto.ts';
import type { AppEnv } from '../src/env.ts';
import {reconcileJobs,failJob} from '../src/jobs.ts';
import {generationError} from '../src/generation-errors.ts';
import {drainNotifications} from '../src/notifications.ts';
import {recentCoverage,generatePreview,generateJob,directly} from '../src/generation.ts';
import {defaultSetup,setupPersona,setupStyle} from '../../lib/setup-config';
import {scanSchedule} from '../src/maintenance';

const runtime = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: 'export default {fetch(){return new Response("local database test")}}',
  compatibilityDate: '2026-10-27',
  d1Databases: ['DB'],
}));
let db: Awaited<ReturnType<typeof runtime.getD1Database>>;
before(async () => {
  db = await runtime.getD1Database('DB');
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) {
    const sql=readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8');
    // Keep trigger bodies together while separating CREATE and ALTER statements.
    await db.batch(sql.replace(/^--.*$/gm,'').split(/;\s*(?=CREATE|ALTER|$)/).map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
  }
});
after(async () => { await runtime.dispose(); });

test('already prepared future occurrences advance instead of blocking the scheduler’s limited batch',async()=>{
  const a=await provisionIdentity(db,{provider:'linkedin',subject:'consumed-slot',name:'Consumed slot'});
  await db.prepare("UPDATE agents SET paused=0,timezone='UTC' WHERE id=?").bind(a.agentId).run();
  const at=new Date(Date.now()+10*60000),time=at.toISOString().slice(11,16),date=at.toISOString().slice(0,10),slot=crypto.randomUUID();
  await db.prepare('INSERT INTO post_slots(id,agent_id,local_time,days_mask,lead_minutes,next_run_at) VALUES(?,?,?,127,15,?)').bind(slot,a.agentId,time,at.toISOString()).run();
  const seq=await saveDraft(db,{agentId:a.agentId,requestId:'consumed-slot-post',text:'This occurrence is already prepared.',rationale:'test',fingerprint:'consumed',sources:[],slotId:slot,slotDate:date,scheduledFor:at.toISOString()});
  await db.prepare("INSERT INTO slot_runs(slot_id,run_date,scheduled_for,post_seq,outcome) VALUES(?,?,?,?,'drafted')").bind(slot,date,at.toISOString(),seq).run();
  await scanSchedule({DB:db} as AppEnv);
  const next=await db.prepare('SELECT next_run_at FROM post_slots WHERE id=?').bind(slot).first<{next_run_at:string}>();
  assert.ok(Date.parse(next!.next_run_at)>at.getTime()+23*3600000);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM generation_jobs WHERE agent_id=?').bind(a.agentId).first())?.n,0);
  await db.prepare('UPDATE agents SET paused=1 WHERE id=?').bind(a.agentId).run();
});

test('one-topic generation keeps a reviewable draft when bounded style repairs remain short',async()=>{
  const a=await provisionIdentity(db,{provider:'linkedin',subject:'short-draft-retention',name:'Retention test'});
  const config={...defaultSetup,categories:['ai-ml'],topics:['AI research'],voice:'inspirational',style:{minWords:200,maxWords:300,hashtagCount:15}};
  await db.prepare('UPDATE agents SET paused=0,categories_json=?,persona_json=?,style_json=? WHERE id=?')
    .bind(JSON.stringify(config.categories),JSON.stringify(setupPersona(config,'Retention test')),JSON.stringify(setupStyle(config)),a.agentId).run();
  const id=crypto.randomUUID(),payload={kind:'manual' as const,agentId:a.agentId,userId:a.userId,agentRevision:0};
  await db.prepare('INSERT INTO generation_jobs(id,agent_id,payload) VALUES(?,?,?)').bind(id,a.agentId,JSON.stringify(payload)).run();
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,init)=>{
    if(!String(url).includes('generativelanguage.googleapis.com'))return new Response('<rss><channel><item><title>New research improves model evaluation</title><link>https://example.com/evaluation</link><description>Researchers compare evaluation methods and explain their limitations.</description></item></channel></rss>');
    const prompt=JSON.parse(String(init?.body));
    const value=calls++===0?[{index:0,category:'ai-ml',persona_fit:8,category_fit:9,novelty:8,timeliness:8,non_duplication:9,reason:'Relevant evaluation evidence'}]
      :prompt.systemInstruction.parts[0].text.includes('ONLY {"addition"')?{addition:'One limitation remains.'}
      :{text:'A clear opening. '+Array(97).fill('evidence').join(' '),rationale:'This research offers evidence about evaluation while clearly describing its limitations for practitioners.',fingerprint:'Evaluation research and practical limitations',continuity:null,used_quote:false,hashtags:Array.from({length:15},(_,i)=>`Topic${i}`)};
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
  };
  try {
    const result=await generateJob({DB:db,GEMINI_API_KEY:'test'} as AppEnv,id,payload,directly);
    assert.ok('seq' in result,JSON.stringify(result));assert.equal(calls,4);
    const post=await db.prepare('SELECT text,review_notes_json,cleared_at FROM posts WHERE agent_id=?').bind(a.agentId).first<{text:string;review_notes_json:string;cleared_at:string|null}>();
    assert.ok(post!.text.startsWith('A clear opening.'));assert.match(post!.review_notes_json,/200–300/);assert.equal(post!.cleared_at,null);
    assert.equal((await db.prepare('SELECT state FROM generation_jobs WHERE id=?').bind(id).first())?.state,'completed');
    const notice=await db.prepare('SELECT payload FROM notification_outbox WHERE dedupe_key=?').bind(`draft:${a.agentId}:1`).first<{payload:string}>();
    assert.equal(JSON.parse(notice!.payload).kind,'draft_ready');assert.match(JSON.parse(notice!.payload).detail,/saved/);
    // A first-run sample also remains available for an explicit review.
    calls=0;
    const firstRun=await provisionIdentity(db,{provider:'linkedin',subject:'retained-first-sample',name:'Sample retention'});
    const sample=await generatePreview({DB:db,GEMINI_API_KEY:'test'} as AppEnv,firstRun.userId,'Sample retention',config);
    assert.ok(sample.text.startsWith('A clear opening.'));assert.match(sample.reviewNotes.join(' '),/200–300/);
  }finally{globalThis.fetch=original;}
});

test('retrying setup excludes the previous sample and includes its category in editorial history',async()=>{
  const a=await provisionIdentity(db,{provider:'linkedin',subject:'preview-diversity',name:'Preview test'});
  await db.prepare('UPDATE onboarding SET preview=?,preview_attempts=2 WHERE user_id=?')
    .bind(JSON.stringify({title:'Earlier music story',sources:['https://example.com/old'],category:'music-tech-software'}),a.userId).run();
  const original=globalThis.fetch;let judged=false;
  globalThis.fetch=async(input,init)=>{
    if(String(input).includes('generativelanguage.googleapis.com')){
      const prompt=JSON.parse(String(init?.body)).contents[0].parts[0].text;
      assert.match(prompt,/music-tech-software .*: 1 of the last 1 posts/);
      assert.match(prompt,/0\. .*Fresh finance story/);
      assert.doesNotMatch(prompt,/\d+\. .*Earlier music story/);
      judged=true;
      return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify([{index:0,category:'finance',persona_fit:0,category_fit:8,novelty:8,timeliness:8,non_duplication:8,reason:'No appropriate story'}])}]}}]});
    }
    return new Response('<rss><channel><item><title>Earlier music story</title><link>https://example.com/old</link></item><item><title>Fresh finance story</title><link>https://example.com/new</link></item></channel></rss>');
  };
  try{
    await assert.rejects(generatePreview({DB:db,GEMINI_API_KEY:'test'} as AppEnv,a.userId,'Preview test',
      {...defaultSetup,categories:['finance','music-tech-software']}),/No source closely matches/);
    assert.equal(judged,true);
  }finally{globalThis.fetch=original;}
});

test('concurrent generated stories cannot reuse a source; retries and other authors remain independent',async()=>{
  const a=await provisionIdentity(db,{provider:'linkedin',subject:'diversity-a',name:'Author A'});
  const b=await provisionIdentity(db,{provider:'linkedin',subject:'diversity-b',name:'Author B'});
  const draft={agentId:a.agentId,text:'A fresh researched story.',rationale:'Relevant',fingerprint:'A fresh story',sources:['https://example.com/fresh'],category:'finance',avoidUsedSources:true};
  const outcomes=await Promise.allSettled(['story-a','story-b'].map(requestId=>saveDraft(db,{...draft,requestId})));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  const saved=await db.prepare('SELECT seq,client_request_id FROM posts WHERE agent_id=?').bind(a.agentId).first<{seq:number;client_request_id:string}>();
  assert.equal(await saveDraft(db,{...draft,requestId:saved!.client_request_id}),saved!.seq);
  assert.equal(await saveDraft(db,{...draft,agentId:b.agentId,requestId:'other-author'}),1);
  await db.prepare("UPDATE posts SET status='rejected' WHERE agent_id=?").bind(a.agentId).run();
  const history=await recentCoverage(db,a.agentId);
  assert.equal(history.length,1);assert.equal(history[0].category,'finance');assert.equal(history[0].status,'rejected');
  await assert.rejects(saveDraft(db,{...draft,requestId:'repeat-rejected'}),/not saved/);
  assert.equal(await saveDraft(db,{...draft,requestId:'manual-reuse',avoidUsedSources:false}),2);
});

test('notification batches stay bounded and each author receives only their own draft notice',async()=>{
  // Clear only this test runtime's old outbox fixtures.
  await db.prepare('DELETE FROM notification_outbox').run();
  const accounts=await Promise.all([0,1,2,3].map(i=>provisionIdentity(db,{provider:'linkedin',subject:`push-owner-${i}`,name:`Push ${i}`})));
  for(const [i,a] of accounts.entries()) {
    await db.prepare('INSERT INTO notification_outbox(agent_id,payload,dedupe_key) VALUES(?,?,?)').bind(a.agentId,JSON.stringify({kind:'draft_ready',seq:i+1}),`push-test:${i}`).run();
    for(let j=0;j<10;j++)await db.prepare('INSERT INTO device_tokens(token,agent_id,platform) VALUES(?,?,?)').bind(`push-${i}-device-${j}`,a.agentId,'android').run();
  }
  const key=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  if(!('privateKey' in key))throw new Error('Expected an RSA key pair');
  const exported=await crypto.subtle.exportKey('pkcs8',key.privateKey);
  if(!(exported instanceof ArrayBuffer))throw new Error('Expected PKCS8 bytes');
  const pem=`-----BEGIN PRIVATE KEY-----\n${Buffer.from(new Uint8Array(exported)).toString('base64')}\n-----END PRIVATE KEY-----`;
  const env={DB:db,FCM_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'test',client_email:'test@example.com',private_key:pem})} as AppEnv;
  let requests=0;const recipients=new Set<string>();const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    requests++;
    if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test'});
    const {message}=JSON.parse(String(init?.body));
    const owner=Number(message.token.split('-')[1]);
    assert.equal(message.data.seq,String(owner+1));
    recipients.add(message.token);
    return Response.json({name:'test-message'});
  };
  try {
    await db.prepare('UPDATE notification_outbox SET retry_at=? WHERE dedupe_key=?').bind(new Date(Date.now()+60000).toISOString(),'push-test:3').run();
    await drainNotifications(env,'push-test:3');assert.equal(requests,0);
    await db.prepare("UPDATE notification_outbox SET retry_at='2020-01-01T00:00:00.000Z' WHERE dedupe_key='push-test:3'").run();
    await drainNotifications(env,'push-test:3');
    assert.equal(requests,11);assert.equal(recipients.size,10);
    assert.ok([...recipients].every(token=>token.startsWith('push-3-')));
    requests=0;recipients.clear();
    await drainNotifications(env);
    assert.equal(requests,33);assert.equal(recipients.size,30);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM notification_outbox WHERE delivered_at IS NULL').first())?.n,0);
    await drainNotifications(env);assert.equal(requests,33);
    await db.prepare('INSERT INTO notification_outbox(agent_id,payload,dedupe_key) VALUES(?,?,?)').bind(accounts[0].agentId,JSON.stringify({kind:'test'}),'partial-delivery').run();
    let fail=true;const tries:string[]=[];
    globalThis.fetch=async(url,init)=>{
      if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test'});
      const token=JSON.parse(String(init?.body)).message.token as string;tries.push(token);
      return token==='push-0-device-7'&&fail?new Response('temporary',{status:503}):Response.json({name:'accepted'});
    };
    await drainNotifications(env,'partial-delivery');assert.equal(tries.length,10);
    const partial=await db.prepare("SELECT delivered_at,delivered_tokens_json FROM notification_outbox WHERE dedupe_key='partial-delivery'").first<{delivered_at:string|null;delivered_tokens_json:string}>();
    assert.equal(partial!.delivered_at,null);assert.equal(JSON.parse(partial!.delivered_tokens_json).length,9);
    fail=false;
    await db.prepare("UPDATE notification_outbox SET retry_at='2020-01-01T00:00:00.000Z' WHERE dedupe_key='partial-delivery'").run();
    await drainNotifications(env,'partial-delivery');assert.equal(tries.length,11);assert.equal(tries.at(-1),'push-0-device-7');
    assert.ok((await db.prepare("SELECT delivered_at FROM notification_outbox WHERE dedupe_key='partial-delivery'").first())?.delivered_at);
  }finally{globalThis.fetch=original;}
});

test('all application tables migrate with foreign keys and JSON validation', async () => {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
  assert.equal(tables.results.length, 28);
  await assert.rejects(db.prepare("INSERT INTO byline_sessions(id,user_id,expires_at) VALUES('missing','missing','2099-01-01T00:00:00.000Z')").run(), /FOREIGN KEY/);
  await assert.rejects(db.prepare("INSERT INTO system_status(key,value) VALUES('invalid','invalid json')").run(), /CHECK/);
});

test('failed workflow reconciliation releases stuck jobs and preserves already saved drafts',async()=>{
  const a=await provisionIdentity(db,{provider:'linkedin',subject:'workflow-recovery',name:'Recovery test'});
  const ids=['stopped','running','saved'].map(()=>crypto.randomUUID());
  for(const id of ids)await db.prepare("INSERT INTO generation_jobs(id,agent_id,payload,state,updated_at) VALUES(?,?,'{}','working','2020-01-01T00:00:00.000Z')").bind(id,a.agentId).run();
  await saveDraft(db,{agentId:a.agentId,requestId:ids[2],text:'The draft survived even though acknowledgement failed.',rationale:'Recovery test',fingerprint:'recovery',sources:[]});
  const env={DB:db,CONTENT:{get:async(id:string)=>({status:async()=>({status:id===ids[1]?'running':'errored'})})}} as unknown as AppEnv;
  await reconcileJobs(env);
  const rows:{id:string;state:string}[]=(await db.prepare('SELECT id,state FROM generation_jobs WHERE agent_id=?').bind(a.agentId).all<{id:string;state:string}>()).results;
  assert.equal(rows.find(r=>r.id===ids[0])?.state,'failed');
  assert.equal(rows.find(r=>r.id===ids[1])?.state,'working');
  assert.equal(rows.find(r=>r.id===ids[2])?.state,'completed');
  await reconcileJobs(env);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM posts WHERE agent_id=?').bind(a.agentId).first())?.n,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM notification_outbox WHERE agent_id=?').bind(a.agentId).first())?.n,2);
  await failJob(db,ids[0],a.agentId,'Still failed');
  await failJob(db,ids[2],a.agentId,'Must not overwrite completed work');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM notification_outbox WHERE agent_id=?').bind(a.agentId).first())?.n,2);
  assert.equal((await db.prepare('SELECT state FROM generation_jobs WHERE id=?').bind(ids[2]).first())?.state,'completed');
  assert.ok(!generationError(new Error('D1_ERROR: sensitive SQL secret-value')).includes('secret-value'));
});

test('simultaneous sign-ins provision exactly one user, agent and onboarding record', async () => {
  const results = await Promise.all(Array.from({length: 8}, () => provisionIdentity(db, {provider:'linkedin',subject:'same-member',name:'Author'})));
  assert.equal(new Set(results.map(r => r.userId)).size, 1);
  assert.equal(new Set(results.map(r => r.agentId)).size, 1);
  const saved = await db.prepare('SELECT paused,auto_publish FROM agents WHERE id=?').bind(results[0].agentId).first();
  assert.deepEqual(saved, {paused:1,auto_publish:0});
  const onboarding = await db.prepare('SELECT count(*) AS n FROM onboarding WHERE user_id=?').bind(results[0].userId).first();
  assert.equal(onboarding?.n, 1);
});

test('sessions cannot cross accounts and revoked or expired sessions are rejected', async () => {
  const a=await provisionIdentity(db,{provider:'google',subject:'first',name:'First'});
  const b=await provisionIdentity(db,{provider:'google',subject:'second',name:'Second'});
  const id=crypto.randomUUID();
  await db.prepare('INSERT INTO byline_sessions(id,user_id,expires_at) VALUES(?,?,?)').bind(id,a.userId,'2099-01-01T00:00:00.000Z').run();
  assert.equal((await sessionOwner(db,a.userId,id))?.agentId,a.agentId);
  assert.equal(await sessionOwner(db,b.userId,id),null);
  assert.equal(await sessionOwner(db,a.userId,id,new Date('2100-01-01')),null);
  await db.prepare('UPDATE byline_sessions SET revoked_at=? WHERE id=?').bind(new Date().toISOString(),id).run();
  assert.equal(await sessionOwner(db,a.userId,id),null);
});

test('a database batch rolls back every write when a later write fails',async()=>{
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO system_status(key,value) VALUES('rollback','{}')"),
    db.prepare("INSERT INTO system_status(key,value) VALUES('invalid','bad json')"),
  ]));
  assert.equal(await db.prepare("SELECT key FROM system_status WHERE key='rollback'").first(),null);
});

test('concurrent saves allocate unique sequence numbers and retries preserve text',async()=>{
  const {agentId}=await provisionIdentity(db,{provider:'linkedin',subject:'draft-author',name:'Writer'});
  const input={agentId,requestId:'one',text:'Original',rationale:'Reason',fingerprint:'fingerprint',sources:[]};
  const results=await Promise.all(Array.from({length:8},()=>saveDraft(db,input)));
  assert.deepEqual([...new Set(results)],[1]);
  assert.equal(await saveDraft(db,{...input,text:'Changed on retry'}),1);
  assert.equal((await db.prepare('SELECT text FROM posts WHERE agent_id=? AND seq=1').bind(agentId).first())?.text,'Original');
  const more=await Promise.all(Array.from({length:8},(_,i)=>saveDraft(db,{...input,requestId:`next-${i}`})));
  assert.deepEqual(more.sort((a,b)=>a-b),[2,3,4,5,6,7,8,9]);
});

test('a repeated timetable occurrence cannot create another draft with a new request ID',async()=>{
  const {agentId}=await provisionIdentity(db,{provider:'linkedin',subject:'slot-author',name:'Writer'});
  const input={agentId,requestId:'first-attempt',text:'One daily draft',rationale:'Reason',fingerprint:'fingerprint',sources:[],slotId:crypto.randomUUID(),slotDate:'2026-10-27'};
  assert.equal(await saveDraft(db,input),1);
  assert.equal(await saveDraft(db,{...input,requestId:'second-attempt'}),1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM posts WHERE agent_id=?').bind(agentId).first())?.n,1);
});

test('AI reservations enforce user and provider limits under concurrency',async()=>{
  const at=new Date('2026-10-27T10:00:00Z');
  const results=await Promise.all(Array.from({length:8},()=>reserveAi(db,'budget-author','budget-model','2026-10-27',at,3,4)));
  assert.equal(results.filter(Boolean).length,3);
  assert.ok(await reserveAi(db,'another-author','budget-model','2026-10-27',at,3,4));
  assert.equal(await reserveAi(db,'third-author','budget-model','2026-10-27',at,3,4),null);
  assert.equal((await db.prepare('SELECT requests FROM ai_user_days WHERE owner=?').bind('budget-author').first())?.requests,3);
});

test('session MACs reject tampering and token encryption authenticates ciphertext',async()=>{
  const user=crypto.randomUUID(), session=crypto.randomUUID(),secret='test-session-secret-with-at-least-32-characters';
  const token=await signSession(secret,user,session,Date.now()+100000);
  assert.deepEqual(await verifySession(secret,token),{userId:user,sessionId:session});
  assert.equal(await verifySession(secret,token.replace(user,crypto.randomUUID())),null);
  assert.equal(await verifySession(secret,token,Date.now()+200000),null);
  const key='1'.repeat(64),encrypted=await encryptToken(key,'test-provider-access-token');
  assert.equal(await decryptToken(key,encrypted),'test-provider-access-token');
  assert.notEqual(encrypted,await encryptToken(key,'test-provider-access-token'));
  await assert.rejects(decryptToken('2'.repeat(64),encrypted));
});

test('native OAuth preserves the mobile contract, claims callback once, and issues one session',async()=>{
  const env:Omit<AppEnv,'CONTENT'|'MAINTENANCE'>={DB:db,APP_SECRET:'test-app-secret-at-least-32-characters',TOKEN_ENCRYPTION_KEY:'a'.repeat(64),
    LINKEDIN_CLIENT_ID:'test-client',LINKEDIN_CLIENT_SECRET:'test-client-secret',GEMINI_API_KEY:'test-key'};
  const verifier='v'.repeat(64);
  const req=(payload:unknown)=>new Request('https://byline.example/api/native-auth',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify(payload)});
  const start=await (await nativeAuth(req({provider:'linkedin',verifier}),env)).json() as {id:string;url:string};
  assert.equal(new URL(start.url).searchParams.get('state'),start.id);
  const original=globalThis.fetch;
  let exchanges=0;
  globalThis.fetch=async url=>{
    if(String(url).endsWith('/accessToken')){exchanges++;return Response.json({access_token:'test-access-token',expires_in:3600});}
    assert.equal(String(url),'https://api.linkedin.com/v2/userinfo');
    return Response.json({sub:'oauth-test-member',name:'OAuth author'});
  };
  try {
    const callback=new Request(`https://byline.example/api/linkedin/callback?state=${start.id}&code=test-code`);
    assert.equal((await authCallback(callback,env)).status,200);
    assert.equal((await authCallback(callback,env)).status,400);
    assert.equal(exchanges,1);
  }finally {globalThis.fetch=original;}
  assert.deepEqual(await (await nativeAuth(req({action:'poll',id:start.id,verifier:'w'.repeat(64)}),env)).json(),{pending:true});
  const polls=await Promise.all(Array.from({length:6},async()=>await (await nativeAuth(req({action:'poll',id:start.id,verifier}),env)).json() as {token?:string;pending?:boolean}));
  const tokens=polls.filter(p=>p.token);
  assert.equal(tokens.length,1);
  const request=new Request('https://byline.example/api/status',{headers:{Authorization:`Bearer ${tokens[0].token}`}});
  assert.equal((await authenticate(request,env))?.name,'OAuth author');
  const encrypted=await db.prepare("SELECT access_token_enc FROM linkedin_accounts WHERE agent_id=(SELECT id FROM agents WHERE owner_id=(SELECT id FROM byline_users WHERE subject='urn:li:person:oauth-test-member'))").first<{access_token_enc:string}>();
  assert.equal(await decryptToken(env.TOKEN_ENCRYPTION_KEY,encrypted!.access_token_enc),'test-access-token');
});
