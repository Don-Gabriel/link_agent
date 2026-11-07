// Operator-only deployment verification. Credentials never leave this process's private output.
// Creates one synthetic author in D1 and removes only that author through the normal API.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {signSession} from '../src/crypto';
import {defaultSetup,setupPersona,setupStyle} from '../../lib/setup-config';
const origin=process.env.BYLINE_CLOUD_ORIGIN;
if(!origin||!/^https:\/\/[a-z0-9.-]+$/.test(origin))throw new Error('Set BYLINE_CLOUD_ORIGIN to the approved HTTPS backend origin');
const secrets=JSON.parse(readFileSync(new URL('../../.byline-local/cloud-secrets.json',import.meta.url),'utf8'));
if(secrets.LINKEDIN_LIVE!=='false')throw new Error('Run this initial release smoke with publishing disabled');
const user=crypto.randomUUID(),agent=crypto.randomUUID(),session=crypto.randomUUID(),expires=Date.now()+30*60000;
const config={...defaultSetup,categories:['ai-ml'],style:{minWords:80,maxWords:160,hashtagCount:0,signature:null}};
const quote=(s:string)=>`'${s.replaceAll("'","''")}'`;
const file=fileURLToPath(new URL('../../.byline-local/remote-smoke.sql',import.meta.url));
function sql(source:string) {
  writeFileSync(file,source);
  try {
    const input=/^\s*SELECT\b/i.test(source)?['--command',source]:['--file',file];
    const output=execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','byline','--remote',...input,'--json'],{encoding:'utf8',maxBuffer:1024*1024});
    const start=output.search(/^\[/m);
    if(start<0)throw new Error('Wrangler did not return its JSON result');
    return JSON.parse(output.slice(start));
  }
  finally {unlinkSync(file);}
}
const token=await signSession(secrets.APP_SECRET,user,session,expires);
async function request(path:string,method='GET',payload?:unknown) {
  const r=await fetch(origin+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(180000)});
  const value=await r.json();
  if(!r.ok)throw new Error(`${path}: HTTP ${r.status}, ${JSON.stringify(value).slice(0,250)}`);
  return value;
}
const report:Record<string,unknown>={at:new Date().toISOString(),origin,phoneTouched:false,linkedinPublished:false};
try {
  sql(`INSERT INTO byline_users(id,provider,subject,name) VALUES(${quote(user)},'linkedin',${quote('deployment-smoke-'+user)},'Deployment verification');
    INSERT INTO agents(id,name,domain,persona_json,persona_hash,owner_id,paused,timezone,categories_json,style_json) VALUES(${quote(agent)},'Deployment verification','AI research',${quote(JSON.stringify(setupPersona(config,'Deployment verification')))},'smoke',${quote(user)},1,'UTC','["ai-ml"]',${quote(JSON.stringify(setupStyle(config)))});
    INSERT INTO onboarding(user_id,config,revision) VALUES(${quote(user)},${quote(JSON.stringify(config))},1);
    INSERT INTO byline_sessions(id,user_id,expires_at) VALUES(${quote(session)},${quote(user)},${quote(new Date(expires).toISOString())});`);
  const status=await request('/api/status');
  console.log(JSON.stringify({stage:'authenticated',initialized:status.initialized,scheduler:status.scheduler}));
  const preview=await request('/api/onboarding','POST',{action:'preview',revision:1});
  if(!preview.preview?.text||preview.preview.testMode!==false)throw new Error('A real preview was not returned');
  report.preview=preview.preview;
  console.log(JSON.stringify({stage:'real-cloud-preview',title:preview.preview.title,words:preview.preview.text.split(/\s+/).length}));
  sql(`UPDATE onboarding SET completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=${quote(user)};
    UPDATE agents SET paused=0 WHERE id=${quote(agent)};`);
  await request('/api/cycle/run','POST',{});
  console.log(JSON.stringify({stage:'cloud-workflow-accepted'}));
  for(let i=0;i<60;i++) {
    await new Promise(r=>setTimeout(r,5000));
    const s=await request('/api/status');
    if(s.queue.length) {
      report.workflowDraft=s.queue[0];report.scheduler=s.scheduler;
      console.log(JSON.stringify({stage:'cloud-workflow-draft',seq:s.queue[0].seq,words:s.queue[0].text.split(/\s+/).length,scheduler:s.scheduler}));
      break;
    }
    if(i%6===5)console.log(JSON.stringify({stage:'waiting-for-cloud-workflow',seconds:(i+1)*5}));
  }
  if(!report.workflowDraft)throw new Error('Cloud workflow did not produce a draft within five minutes');
  report.ok=true;
} catch(error) {report.ok=false;report.error=error instanceof Error?error.message:'Verification failed';process.exitCode=1;console.log(JSON.stringify({ok:false,error:report.error}));}
finally {
  // Preserve diagnostic job states before removing only this disposable author.
  try {report.jobs=sql(`SELECT state,stage,error FROM generation_jobs WHERE agent_id=${quote(agent)};`)[0]?.results;}catch {report.diagnosticsUnavailable=true;}
  try {await request('/api/account/delete','POST',{confirmation:'DELETE'});report.cleanup=true;}
  catch {report.cleanup=false;report.cleanupUser=user;report.cleanupAgent=agent;}
  writeFileSync(new URL('../../.byline-local/cloud-remote-smoke.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:report.ok,cleanup:report.cleanup,jobs:report.jobs}));
}
