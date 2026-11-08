import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {compatibleConfig,compatibleComplete} from '../../lib/ai-compatible';
import {completion,durableCompletion} from '../src/ai';
import {serviceCompletion,aiAllowance} from '../src/ai-service';
import {provisionIdentity} from '../src/identities';
import type {AppEnv} from '../src/env';
import {workersAiComplete,workersAiConfig,WORKERS_AI_MODEL} from '../src/ai-workers';
import {judgeSchema} from '../../lib/ai-schemas';
import {dispatchMaintenance} from '../src/maintenance-dispatch';
import {dispatchJobs,reconcileJobs} from '../src/jobs';
import {generateJob} from '../src/generation';
import {defaultSetup,setupPersona,setupStyle} from '../../lib/setup-config';
import {postsRoute} from '../src/posts';

const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-10-27',d1Databases:['DB']}));
let db:Awaited<ReturnType<typeof runtime.getD1Database>>;
before(async()=>{
  db=await runtime.getD1Database('DB');
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) {
    const sql=readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8');
    await db.batch(sql.replace(/^--.*$/gm,'').split(/;\s*(?=CREATE|ALTER|$)/).map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
  }
});
after(()=>runtime.dispose());
const args={system:'Return JSON.',user:'Synthetic test only.',jsonMode:true,maxOutputTokens:128};
const wire=(text='{"text":"synthetic answer"}')=>Response.json({choices:[{finish_reason:'stop',message:{content:text}}],usage:{prompt_tokens:80,completion_tokens:20}});
async function author() {return provisionIdentity(db,{provider:'linkedin',subject:crypto.randomUUID(),name:'AI test'});}
function env(overrides:Partial<AppEnv>={}):AppEnv {
  return {DB:db,AI_PROVIDER:'compatible',AI_BASE_URL:'https://inference.example/v1',AI_MODEL:'tested-model',AI_SERVICE_TOKEN:'t'.repeat(40),TOKEN_ENCRYPTION_KEY:'e'.repeat(64),...overrides} as AppEnv;
}
test('remote inference requires TLS and a server credential; loopback is explicit',()=>{
  for(const value of [
    {AI_BASE_URL:'http://inference.example/v1',AI_MODEL:'x',AI_SERVICE_TOKEN:'t'.repeat(40)},
    {AI_BASE_URL:'https://inference.example/v1',AI_MODEL:'x'},
    {AI_BASE_URL:'https://user:password@inference.example/v1',AI_MODEL:'x'},
    {AI_BASE_URL:'http://127.0.0.1:11434/v1',AI_MODEL:'x'},
  ])assert.throws(()=>compatibleConfig(value));
  assert.equal(compatibleConfig({AI_BASE_URL:'http://127.0.0.1:11434/v1/',AI_MODEL:'x',AI_ALLOW_LOCAL_HTTP:'true'}).baseUrl,'http://127.0.0.1:11434/v1');
});
test('transport bounds requests, preserves array schemas and rejects incomplete or invalid outputs',async()=>{
  const cfg=compatibleConfig(env());let requests=0;
  const fetcher:typeof fetch=async(url,init)=>{
    requests++;assert.equal(String(url),'https://inference.example/v1/chat/completions');assert.equal(init?.redirect,'error');
    const data=JSON.parse(String(init?.body));assert.equal(data.response_format.json_schema.schema.type,'array');assert.equal(data.stream,false);return wire('[]');
  };
  assert.equal((await compatibleComplete(cfg,{...args,jsonSchema:judgeSchema},'id',fetcher)).ok,true);
  assert.equal((await compatibleComplete({...cfg,maxInputBytes:10},args,'id',fetcher)).ok,false);
  assert.equal((await compatibleComplete(cfg,{...args,maxOutputTokens:9000},'id',fetcher)).ok,false);assert.equal(requests,1);
  assert.deepEqual(await compatibleComplete(cfg,args,undefined,async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]})),{ok:false,reason:'incomplete_or_blocked_completion'});
  assert.deepEqual(await compatibleComplete(cfg,args,undefined,async()=>wire('not json')),{ok:false,reason:'provider_invalid_json'});
  assert.deepEqual(await compatibleComplete(cfg,args,undefined,async()=>new Response('bad gateway JSON')),{ok:false,reason:'provider_invalid_json'});
  assert.deepEqual(await compatibleComplete(cfg,args,undefined,async()=>{throw new DOMException('private diagnostic','TimeoutError');}),{ok:false,reason:'provider_timeout'});
});
test('replay reuses encrypted output without charging; tenant and revocation boundaries hold',async()=>{
  const a=await author(),b=await author(),original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return wire();};
  try {
    const complete=serviceCompletion(env(),a.userId,'job-one');
    assert.deepEqual(await complete(args),await complete(args));assert.equal(calls,1);assert.equal((await aiAllowance(env(),a.userId)).used,1);
    const row=await db.prepare('SELECT result_enc FROM ai_requests WHERE owner=?').bind(a.userId).first<{result_enc:string}>();
    assert.ok(row!.result_enc.startsWith('v1:'));assert.doesNotMatch(row!.result_enc,/synthetic/);
    assert.equal((await serviceCompletion(env(),b.userId,'job-one')(args)).ok,true);assert.equal(calls,2);
    await db.prepare('INSERT INTO ai_account_limits(owner,daily_attempt_limit,enabled) VALUES(?,40,0)').bind(a.userId).run();
    assert.deepEqual(await complete(args),{ok:false,reason:'ai_access_disabled'});assert.equal(calls,2);
  }finally{globalThis.fetch=original;}
});
test('account allowance is atomic across concurrent requests',async()=>{
  const a=await author(),original=globalThis.fetch;let calls=0;
  await db.prepare('INSERT INTO ai_account_limits(owner,daily_attempt_limit,max_parallel) VALUES(?,2,32)').bind(a.userId).run();
  globalThis.fetch=async()=>{calls++;return wire();};
  try {
    const cfg=env({AI_MAX_CONCURRENCY:'32'});
    await Promise.all(Array.from({length:12},(_,i)=>serviceCompletion(cfg,a.userId,`job-${i}`)({...args,user:`test ${i}`})));
    assert.equal(calls,2);assert.equal((await aiAllowance(cfg,a.userId)).used,2);
  }finally{globalThis.fetch=original;}
});
test('expired entitlement denies generation',async()=>{
  const a=await author();await db.prepare('INSERT INTO ai_account_limits(owner,daily_attempt_limit,expires_at) VALUES(?,50,?)').bind(a.userId,'2020-01-01T00:00:00.000Z').run();
  assert.deepEqual(await serviceCompletion(env(),a.userId,'expired')(args),{ok:false,reason:'ai_access_disabled'});
});
test('distributed concurrency and expired-lease fencing prevent late response overwrite',async()=>{
  const a=await author(),b=await author(),original=globalThis.fetch;let release!:()=>void,started!:()=>void;
  const ready=new Promise<void>(r=>started=r),held=new Promise<void>(r=>release=r);let calls=0;
  globalThis.fetch=async()=>{calls++;if(calls===1){started();await held;}return wire(`{"version":${calls}}`);};
  try {
    const cfg=env({AI_MODEL:'lease-test'}),fn=serviceCompletion(cfg,a.userId,'lease');
    const first=fn(args);await ready;
    assert.deepEqual(await fn(args),{ok:false,reason:'ai_busy'});
    assert.deepEqual(await serviceCompletion(cfg,b.userId,'other')(args),{ok:false,reason:'ai_busy'});
    assert.equal((await aiAllowance(cfg,b.userId)).used,0);
    await db.prepare('UPDATE ai_requests SET lease_until=0 WHERE owner=?').bind(a.userId).run();
    const replacement=await fn(args);assert.equal(replacement.ok,true);
    release();assert.deepEqual(await first,{ok:false,reason:'ai_busy'});
    assert.deepEqual(await fn(args),replacement);assert.equal(calls,2);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM ai_usage WHERE owner=?').bind(a.userId).first())?.n,1);
  }finally{release?.();globalThis.fetch=original;}
});
test('429 persists cooldown; permanent errors never retry or fall back',async()=>{
  const a=await author(),original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('private provider diagnostic',{status:calls===1?429:401,headers:{'Retry-After':'60'}});};
  try {
    const cfg=env({AI_MODEL:'retry-test'}),fn=serviceCompletion(cfg,a.userId,'retry');
    assert.deepEqual(await fn(args),{ok:false,reason:'provider_overloaded',retryAfterMs:60000});
    await assert.rejects(()=>durableCompletion(fn)(args),/ai_retry_later/);assert.equal(calls,1);
    const other=await serviceCompletion(cfg,a.userId,'different')(args);assert.ok(!other.ok&&other.reason==='ai_circuit_open');
    await db.prepare('UPDATE ai_requests SET retry_at=0 WHERE owner=?').bind(a.userId).run();
    await db.prepare('UPDATE ai_service_health SET blocked_until=0').run();
    assert.deepEqual(await fn(args),{ok:false,reason:'provider_http_401'});
    assert.deepEqual(await fn(args),{ok:false,reason:'provider_http_401'});assert.equal(calls,2);
  }finally{globalThis.fetch=original;}
});
test('bad service configuration cannot fall through to Gemini',async()=>{
  const a=await author();assert.deepEqual(await completion(env({AI_BASE_URL:undefined,GEMINI_API_KEY:'must-not-use'}),a.userId)(args),{ok:false,reason:'ai_configuration_invalid'});
});

test('an expired interactive deadline consumes no inference allowance',async()=>{
  const a=await author();
  assert.deepEqual(await completion(env(),a.userId,'deadline',Date.now()-1)(args),{ok:false,reason:'ai_deadline_exceeded'});
  assert.equal((await aiAllowance(env(),a.userId)).used,0);
  assert.deepEqual(await completion(env({AI_MAX_CONCURRENCY:'0'}),a.userId)(args),{ok:false,reason:'ai_configuration_invalid'});
});
test('Workers AI uses its native binding with schema and cancellation',async()=>{
  const cfg=env({AI_PROVIDER:'workers-ai',AI_MODEL:WORKERS_AI_MODEL,AI_DISABLE_THINKING:'true'});let calls=0;
  cfg.AI={run:async(model:string,input:Record<string,unknown>,options:AiOptions)=>{
    calls++;assert.equal(model,WORKERS_AI_MODEL);assert.equal(input.reasoning_effort,undefined);
    assert.deepEqual(input.chat_template_kwargs,{enable_thinking:false});assert.ok(options.signal);assert.equal(options.returnRawResponse,true);return wire('[]');
  }} as Ai;
  assert.equal((await workersAiComplete(cfg,workersAiConfig(cfg),{...args,jsonSchema:judgeSchema},'native-test')).ok,true);assert.equal(calls,1);
});

test('GLM native selection uses the configured model and polished scheduled text still requires review',async()=>{
  const a=await author();
  const setup={...defaultSetup,style:{minWords:80,maxWords:160,hashtagCount:0}};
  await db.prepare('UPDATE agents SET style_json=? WHERE id=?').bind(JSON.stringify(setupStyle(setup)),a.agentId).run();
  const cfg=env({AI_PROVIDER:'workers-ai',AI_MODEL:'@cf/zai-org/glm-4.7-flash',AI_DISABLE_THINKING:'true',AI:{run:async(model:string)=>{
    assert.equal(model,'@cf/zai-org/glm-4.7-flash');
    return wire(JSON.stringify({text:'A clear opening. '+Array(97).fill('evidence').join(' '),rationale:'The author supplied this idea and the draft preserves the original factual boundaries in polished prose.',fingerprint:'Polishing the supplied idea and factual boundaries',continuity:null,used_quote:false,hashtags:[]}));
  }} as unknown as Ai});
  const request=new Request('https://byline.example/api/posts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'An original draft supplied by the author for polishing.',polish:true,clientRequestId:crypto.randomUUID(),scheduledFor:new Date(Date.now()+3600000).toISOString()})});
  const response=await postsRoute(request,cfg,{...a,name:'Test',sessionId:'test'});
  assert.equal(response.status,200);
  const post=await db.prepare('SELECT cleared_at,requires_review,review_notes_json FROM posts WHERE agent_id=?').bind(a.agentId).first();
  assert.equal(post?.cleared_at,null);assert.equal(post?.requires_review,1);assert.match(String(post?.review_notes_json),/factual claims/);
});

test('Workers AI classifies quota, capacity and permanent configuration failures without leaking diagnostics',async()=>{
  const cfg=env({AI_PROVIDER:'workers-ai',AI_MODEL:WORKERS_AI_MODEL});
  for(const [code,reason] of [['3036','provider_quota_reached'],['3040','provider_overloaded'],['5035','provider_http_403'],['5016','provider_http_403'],['5028','provider_http_410'],['5007','provider_http_400'],['3007','provider_http_504']]) {
    cfg.AI={run:async()=>{throw new Error(`${code}: private provider details`);}} as unknown as Ai;
    const result=await workersAiComplete(cfg,workersAiConfig(cfg),args,'native-error');
    assert.ok(!result.ok);assert.equal(result.reason,reason);assert.doesNotMatch(JSON.stringify(result),/private/);
  }
});

test('native daily exhaustion blocks other requests until the UTC reset',async()=>{
  const a=await author(),b=await author();let calls=0;
  const cfg=env({AI_PROVIDER:'workers-ai',AI_MODEL:WORKERS_AI_MODEL,AI:{run:async()=>{calls++;throw new Error('3036 daily quota');}} as unknown as Ai});
  assert.deepEqual(await serviceCompletion(cfg,a.userId,'quota')(args),{ok:false,reason:'provider_quota_reached'});
  const next=await serviceCompletion(cfg,b.userId,'quota-other')(args);
  assert.ok(!next.ok&&next.reason==='ai_circuit_open');assert.equal(calls,1);
  const health=await db.prepare('SELECT blocked_until FROM ai_service_health WHERE blocked_until>?').bind(Date.now()).first<{blocked_until:number}>();
  assert.equal(health!.blocked_until%86400000,0);
  await db.prepare('UPDATE ai_service_health SET blocked_until=0').run();
});
test('idle minute ticks avoid durable workflows; hourly cleanup still runs and failed dispatch leaves heartbeat unchanged',async()=>{
  let dispatched=0;
  const cfg=env({MAINTENANCE:{createBatch:async()=>{dispatched++;return [];}} as unknown as AppEnv['MAINTENANCE']});
  const idle=Date.parse('2026-11-09T00:01:00Z');
  assert.equal(await dispatchMaintenance(cfg,idle),false);assert.equal(dispatched,0);
  assert.equal(await dispatchMaintenance(cfg,Date.parse('2026-11-09T01:00:00Z')),true);assert.equal(dispatched,1);
  const heartbeat=await db.prepare("SELECT updated_at FROM system_status WHERE key='cloud_scheduler'").first();
  cfg.MAINTENANCE={createBatch:async()=>{throw new Error('unavailable');}} as unknown as AppEnv['MAINTENANCE'];
  await assert.rejects(()=>dispatchMaintenance(cfg,Date.parse('2026-11-09T02:00:00Z')));
  assert.deepEqual(await db.prepare("SELECT updated_at FROM system_status WHERE key='cloud_scheduler'").first(),heartbeat);
});
test('generation bursts stay queued and an interrupted dispatch is recovered',async()=>{
  const a=await author();let creates=0;
  for(let i=0;i<6;i++)await db.prepare('INSERT INTO generation_jobs(id,agent_id,payload) VALUES(?,?,?)')
    .bind(`dispatch-${i}`,a.agentId,JSON.stringify({kind:'manual',agentId:a.agentId,userId:a.userId,agentRevision:0})).run();
  const cfg=env({AI_ACTIVE_JOBS:'2',CONTENT:{createBatch:async()=>{creates++;return [{}];},get:async()=>{throw new Error('Missing instance');}} as unknown as AppEnv['CONTENT']});
  await Promise.all([dispatchJobs(cfg),dispatchJobs(cfg)]);assert.equal(creates,2);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM generation_jobs WHERE state='queued'").first())?.n,4);
  await db.prepare("UPDATE generation_jobs SET updated_at='2000-01-01T00:00:00.000Z' WHERE state='working'").run();
  await reconcileJobs(cfg);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM generation_jobs WHERE state='queued'").first())?.n,6);
  await db.prepare('DELETE FROM generation_jobs WHERE agent_id=?').bind(a.agentId).run();
});
test('retries stop at a persistent per-request ceiling even across new completion instances',async()=>{
  const a=await author(),original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(null,{status:503});};
  try {
    const cfg=env({AI_MODEL:'failure-ceiling'});
    for(let i=0;i<3;i++) {
      assert.equal((await serviceCompletion(cfg,a.userId,'same-operation')(args)).ok,false);
      await db.prepare('UPDATE ai_requests SET retry_at=0 WHERE owner=?').bind(a.userId).run();
      await db.prepare('UPDATE ai_service_health SET blocked_until=0').run();
    }
    assert.deepEqual(await serviceCompletion(cfg,a.userId,'same-operation')(args),{ok:false,reason:'ai_attempts_exhausted'});assert.equal(calls,3);
  }finally{globalThis.fetch=original;}
});

test('the new provider completes a generation with a review guard and replayed AI steps consume no new attempts',async()=>{
  const a=await author(),original=globalThis.fetch;
  const setup={...defaultSetup,categories:['ai-ml'],topics:['AI research'],style:{minWords:80,maxWords:160,hashtagCount:0}};
  await db.prepare('UPDATE agents SET paused=0,categories_json=?,persona_json=?,style_json=? WHERE id=?')
    .bind(JSON.stringify(setup.categories),JSON.stringify(setupPersona(setup,'Test')),JSON.stringify(setupStyle(setup)),a.agentId).run();
  const id=crypto.randomUUID(),payload={kind:'manual' as const,agentId:a.agentId,userId:a.userId,agentRevision:0};
  await db.prepare('INSERT INTO generation_jobs(id,agent_id,payload) VALUES(?,?,?)').bind(id,a.agentId,JSON.stringify(payload)).run();
  let calls=0;
  globalThis.fetch=async(url,init)=>{
    if(!String(url).includes('inference.example'))return new Response('<rss><channel><item><title>Research evaluates model reliability</title><link>https://example.com/service-evaluation</link><description>Researchers compare evaluation methods and their limitations.</description></item></channel></rss>');
    calls++;const request=JSON.parse(String(init?.body));
    const data=request.response_format.json_schema.schema.type==='array'
      ? [{index:0,category:'ai-ml',persona_fit:8,category_fit:9,novelty:8,timeliness:8,non_duplication:9,reason:'Relevant evaluation evidence'}]
      : {text:'A clear opening. '+Array(97).fill('evidence').join(' '),rationale:'The research supports a concrete discussion of evaluation and reports limitations without unsupported personal claims.',fingerprint:'Research on evaluation and documented limitations',continuity:null,used_quote:false,hashtags:[]};
    return wire(JSON.stringify(data));
  };
  try {
    const cfg=env({AI_MODEL:'generation-integration'});
    const result=await generateJob(cfg,id,payload,async(name,work)=>{
      // Simulate losing the Workflow acknowledgement after judge/write completed.
      const first=await work();
      if(name==='judge'||name==='write')assert.deepEqual(await work(),first);
      return first;
    });
    assert.ok('seq' in result,JSON.stringify(result));assert.equal(calls,2);
    const saved=await db.prepare('SELECT review_notes_json,requires_review,cleared_at FROM posts WHERE agent_id=?').bind(a.agentId).first();
    assert.equal(saved?.requires_review,1);assert.equal(saved?.cleared_at,null);assert.match(String(saved?.review_notes_json),/factual claims/);
    assert.equal((await aiAllowance(cfg,a.userId)).used,2);
  }finally{globalThis.fetch=original;}
});
