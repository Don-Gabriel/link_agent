import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {existsSync} from 'node:fs';
import {ensureSchema,query,getPool} from '../lib/db';
import {provisionUser,digest,issueSession} from '../lib/native-auth';
import {saveAiCredential,readAiCredential,aiStatus,reserveKeyCheck,validateAiKey} from '../lib/ai-credentials';
import {withUserUsage,withAgentUsage} from '../lib/ai-usage';
import {complete,pacificToday} from '../lib/llm';
import {decrypt} from '../lib/crypto';

const model='gemini-3.5-flash-lite';
const keyA='fake-client-a-key-000000000001';
const keyB='fake-client-b-key-000000000002';
const realFetch=globalThis.fetch;
let responseStatus=200;
const calls:string[]=[];
globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init);
  assert.equal(new URL(request.url).hostname,'generativelanguage.googleapis.com','Unexpected external request');
  const key=request.headers.get('x-goog-api-key');
  assert.ok(key===keyA||key===keyB,'Only synthetic client keys may reach mocked Gemini');
  calls.push(key!);
  return Response.json(responseStatus===200
    ? {candidates:[{content:{parts:[{text:'A synthetic completion.'}],role:'model'},finishReason:'STOP'}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:4}}
    : {error:{code:responseStatus,message:`Rejected key ${key}`,status:responseStatus===429?'RESOURCE_EXHAUSTED':'PERMISSION_DENIED'}}, {status:responseStatus});
};
const prompt={system:'A test only.',user:'Return a synthetic response.'};
async function resetBudget(user:string) {
  await query('DELETE FROM ai_user_days WHERE owner=$1',[user]);
  await query('DELETE FROM ai_scoped_provider_days WHERE owner=$1',[user]);
}

async function apiChecks(a:string,b:string) {
  if(!existsSync('.next-verify/BUILD_ID'))throw new Error('Run npm run build:check before test:byok.');
  const port=await new Promise<number>(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const address=s.address() as {port:number};s.close(()=>resolve(address.port));});});
  const base=`http://127.0.0.1:${port}`;
  const tokenA=await issueSession(a),tokenB=await issueSession(b);
  const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{
    env:{...process.env,NEXT_DIST_DIR:'.next-verify',PORT:String(port),BYLINE_PUBLIC_URL:base,BYLINE_TEST_MODE:'true',BYLINE_LOCAL_ONLY:'false'},
    stdio:['ignore','pipe','pipe'],windowsHide:true,
  });
  let logs='';
  server.stdout.on('data',b=>logs+=b.toString());server.stderr.on('data',b=>logs+=b.toString());
  try {
    let ready=false;
    for(let i=0;i<60;i++) {
      try {if((await realFetch(`${base}/api/health`)).ok){ready=true;break;}}catch{}
      if(server.exitCode!==null)break;
      await new Promise(r=>setTimeout(r,500));
    }
    assert.ok(ready,'Isolated API server did not start');
    const request=(path:string,token?:string,method='GET',body?:unknown)=>realFetch(base+path,{
      method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',
    });
    assert.equal((await request('/api/ai')).status,401);
    assert.equal((await request('/api/account/export')).status,401);
    const own=await (await request('/api/ai',tokenA)).json();
    assert.equal(own.keyHint,keyA.slice(-4));
    assert.ok(!JSON.stringify(own).includes(keyA));
    const other=await (await request('/api/ai?userId='+b,tokenA)).json();
    assert.equal(other.keyHint,keyA.slice(-4),'Query parameters cannot select another account');
    const exported=await (await request('/api/account/export',tokenA)).json();
    assert.equal(exported.account.name,'Synthetic Author A');
    assert.ok(!JSON.stringify(exported).includes('Synthetic Author B'));
    assert.ok(!JSON.stringify(exported).includes('key_enc'));
    assert.ok(!JSON.stringify(exported).includes(keyA));
    assert.equal((await request('/api/ai',tokenA,'POST',{apiKey:keyA})).status,409,'Preview cannot make live validation calls');
    assert.equal((await request('/api/ai?userId='+b,tokenA,'DELETE')).status,200);
    assert.equal((await aiStatus(a)).connected,false);
    assert.equal((await aiStatus(b)).connected,true);
    await query('UPDATE byline_sessions SET revoked_at=now() WHERE user_id=$1',[a]);
    assert.equal((await request('/api/account/export',tokenA)).status,401,'Revoked session must not export');
    assert.equal((await request('/api/cron/wake')).status,404);
    const wake=await realFetch(base+'/api/cron/wake',{headers:{'X-Cron-Secret':process.env.CRON_SECRET!}});
    assert.equal(wake.status,202);
    let tick=false;
    for(let i=0;i<30;i++) {
      tick=(await query("SELECT 1 FROM system_status WHERE key='last_tick'")).length>0;
      if(tick)break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert.ok(tick,'Authorized wake must reach the scheduler in the background');
    assert.equal((await request('/api/auth',undefined,'POST',{password:'anything'})).status,503,'Shared login disabled');
    const home=await request('/');assert.ok((await home.text()).includes('ByLine'));
    assert.equal((await request('/privacy')).status,200);
    assert.equal((await request('/support')).status,200);
    assert.equal((await request('/api/account/export',tokenB)).status,200);
    console.log('PASS HTTP authorization, per-user export, key removal, revoked sessions and public pages');
  } catch(error) {
    console.error('API isolation check failed:',error);
    console.error(logs);
    throw error;
  } finally {
    const closed=new Promise<void>(resolve=>{
      if(server.exitCode!==null||server.signalCode!==null)return resolve();
      server.once('exit',()=>resolve());
    });
    server.kill();
    await closed;
  }
}

async function main() {
  await ensureSchema();
  const a=await provisionUser('local',randomUUID(),'Synthetic Author A');
  const b=await provisionUser('local',randomUUID(),'Synthetic Author B');
  const missing=await provisionUser('local',randomUUID(),'No key');
  await saveAiCredential(a,keyA,model,'free');await saveAiCredential(b,keyB,model,'paid');
  assert.equal((await readAiCredential(a))?.apiKey,keyA);
  const [encrypted]=await query<{key_enc:string}>('SELECT key_enc FROM byline_ai_credentials WHERE user_id=$1',[a]);
  assert.notEqual(encrypted.key_enc,keyA);
  assert.throws(()=>decrypt(encrypted.key_enc,`byline-gemini:${b}`),'Ciphertext must be bound to its owner');
  assert.ok(!JSON.stringify(await aiStatus(a)).includes(keyA));
  const [agent]=await query<{id:string}>('SELECT id FROM agents WHERE owner_id=$1',[b]);
  const completed=await Promise.all([withUserUsage(a,()=>complete(prompt)),withAgentUsage(agent.id,()=>complete(prompt))]);
  assert.ok(completed.every(r=>r.ok));assert.deepEqual(new Set(calls),new Set([keyA,keyB]));
  const previous=calls.length;
  assert.deepEqual(await withUserUsage(missing,()=>complete(prompt)),{ok:false,reason:'ai_key_required'});
  assert.deepEqual(await complete(prompt),{ok:false,reason:'ai_key_required'});
  assert.equal(calls.length,previous,'No operator fallback for missing ownership or key');
  await query('UPDATE ai_user_days SET requests=4 WHERE owner=$1 AND day=$2',[a,pacificToday()]);
  assert.deepEqual(await withUserUsage(a,()=>complete(prompt)),{ok:false,reason:'ai_quota_exhausted'});
  await resetBudget(b);
  assert.equal((await withUserUsage(b,()=>complete(prompt))).ok,true,'Other user quota remains available');
  await saveAiCredential(a,keyB,model,'free');
  assert.deepEqual(await withUserUsage(a,()=>complete(prompt)),{ok:false,reason:'ai_quota_exhausted'},'Rotation does not reset allowance');
  await saveAiCredential(a,keyA,model,'free');await resetBudget(a);
  responseStatus=429;
  const before429=calls.length;
  assert.deepEqual(await withUserUsage(a,()=>complete(prompt)),{ok:false,reason:'ai_quota_exhausted'});
  assert.equal(calls.length,before429+1,'SDK must not silently retry quota errors');
  assert.equal((await aiStatus(a)).error,'ai_quota_exhausted');
  await resetBudget(a);responseStatus=403;
  assert.deepEqual(await withUserUsage(a,()=>complete(prompt)),{ok:false,reason:'ai_key_invalid'});
  assert.ok(!JSON.stringify(await aiStatus(a)).includes(keyA));
  responseStatus=200;await validateAiKey(keyA,model);
  const checks=await Promise.all(Array.from({length:8},()=>reserveKeyCheck(a)));
  assert.equal(checks.filter(Boolean).length,1,'Concurrent validations are throttled');
  console.log('PASS encrypted keys, concurrent client routing, quotas, no fallback, safe errors and validation throttle');
  process.env.BYLINE_REGISTRATION_MODE='invite';
  await assert.rejects(()=>provisionUser('local',randomUUID(),'Uninvited'),/invitation/);
  const invite=digest(randomUUID());
  await query("INSERT INTO byline_invites(code_hash,expires_at) VALUES($1,now()+interval '1 hour')",[invite]);
  const invited=await Promise.allSettled([provisionUser('local',randomUUID(),'Invited 1',invite),provisionUser('local',randomUUID(),'Invited 2',invite)]);
  assert.equal(invited.filter(r=>r.status==='fulfilled').length,1);
  const [existing]=await query<{subject:string}>('SELECT subject FROM byline_users WHERE id=$1',[a]);
  assert.equal(await provisionUser('local',existing.subject,'Synthetic Author A'),a,'Existing users do not need another invite');
  console.log('PASS one-use invitations and returning sign-in');
  await apiChecks(a,b);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{globalThis.fetch=realFetch;await getPool()?.end();});
