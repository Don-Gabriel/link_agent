import { spawn } from 'node:child_process';
import { writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { liveEnv } from './live-env.mjs';
import { googleOperatorCredentials,googleOperatorFetch } from './google-operator.mjs';
const env=liveEnv();
let geminiProject;
function save(file,data){writeFileSync(file+'.tmp',JSON.stringify(data),{mode:0o600});renameSync(file+'.tmp',file);}
async function refreshCredentials() {
  if(!geminiProject){const r=await googleOperatorFetch(`https://apikeys.googleapis.com/v2/keys:lookupKey?keyString=${encodeURIComponent(env.GEMINI_API_KEY)}`);if(!r.ok)throw new Error('Cannot verify the Gemini project.');geminiProject=(await r.json()).parent.split('/')[1];}
  const r=await googleOperatorFetch(`https://cloudbilling.googleapis.com/v1/projects/${geminiProject}/billingInfo`);
  if(!r.ok||(await r.json()).billingEnabled!==false)throw new Error('Zero-budget guard: billing is enabled or could not be verified. AI remains disabled.');
  const credentials=await googleOperatorCredentials();
  save(env.FCM_ACCESS_TOKEN_FILE,credentials);
  save(env.BYLINE_ZERO_BUDGET_STATE_FILE,{keyHash:createHash('sha256').update(env.GEMINI_API_KEY).digest('hex'),billingEnabled:false,verifiedUntil:Date.now()+20*60_000});
}
await refreshCredentials();
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',env.PORT],{env,stdio:'inherit',windowsHide:true});
let ticking=false;
const tick=setInterval(async()=>{if(ticking)return;ticking=true;try{await fetch(`http://127.0.0.1:${env.PORT}/api/cron/tick`,{headers:{'x-cron-secret':env.CRON_SECRET},signal:AbortSignal.timeout(20000)});}catch{}finally{ticking=false;}},30000);
const refresh=setInterval(()=>refreshCredentials().catch(()=>console.error('Could not refresh free-tier verification. Generation will stop when verification expires.')),10*60_000);
server.on('exit',code=>{clearInterval(tick);clearInterval(refresh);process.exit(code??0);});
process.on('SIGINT',()=>{clearInterval(tick);clearInterval(refresh);server.kill();});
console.log('ByLine live development: billing verified disabled; real Gemini and LinkedIn available. Keep this server running.');
