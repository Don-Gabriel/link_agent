// Real AI, isolated local database. Never publishes, changes cloud data, or touches a phone.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {provisionIdentity} from '../src/identities';
import {signSession} from '../src/crypto';
import {defaultSetup} from '../../lib/setup-config';
// @ts-expect-error Existing local operator helper is JavaScript; its token is never persisted here.
import {googleOperatorFetch} from '../../scripts/google-operator.mjs';
const env=parseEnv(readFileSync(new URL('../../.env',import.meta.url),'utf8'));
if(!env.GEMINI_API_KEY)throw new Error('Gemini key is missing');
const lookup=await googleOperatorFetch(`https://apikeys.googleapis.com/v2/keys:lookupKey?keyString=${encodeURIComponent(env.GEMINI_API_KEY)}`);
if(!lookup.ok)throw new Error('Unable to verify the Gemini project');
const project=(await lookup.json()).parent.split('/')[1];
const billing=await googleOperatorFetch(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`);
if(!billing.ok||(await billing.json()).billingEnabled!==false)throw new Error('Billing must be verified disabled before this smoke test');
const secret=crypto.randomUUID()+crypto.randomUUID();
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,
  scriptPath:fileURLToPath(new URL('../.wrangler/test-build/index.js',import.meta.url)),compatibilityDate:'2026-10-27',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
  workflows:{CONTENT:{name:'byline-content',className:'ContentWorkflow'},MAINTENANCE:{name:'byline-maintenance',className:'MaintenanceWorkflow'}},
  bindings:{APP_SECRET:secret,TOKEN_ENCRYPTION_KEY:'c'.repeat(64),GEMINI_API_KEY:env.GEMINI_API_KEY},
}));
try {
  const db=await runtime.getD1Database('DB');
  for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) {
    const sql=readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8');
    await db.batch(sql.replace(/^--.*$/gm,'').split(/;\s*(?=CREATE|ALTER|$)/).map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
  }
  const author=await provisionIdentity(db,{provider:'linkedin',subject:'isolated-live-smoke',name:'ByLine test author'});
  const session=crypto.randomUUID(),expires=Date.now()+600000;
  await db.prepare('INSERT INTO byline_sessions(id,user_id,expires_at) VALUES(?,?,?)').bind(session,author.userId,new Date(expires).toISOString()).run();
  const config={...defaultSetup,categories:['ai-ml'],style:{minWords:80,maxWords:160,hashtagCount:0,signature:null}};
  await db.prepare('UPDATE onboarding SET config=?,revision=1 WHERE user_id=?').bind(JSON.stringify(config),author.userId).run();
  const response=await runtime.dispatchFetch('https://byline.example/api/onboarding',{method:'POST',headers:{Authorization:`Bearer ${await signSession(secret,author.userId,session,expires)}`,'Content-Type':'application/json'},body:JSON.stringify({action:'preview',revision:1})});
  const result=await response.json() as {error?:string;preview?:{text:string;title:string;sources:string[];testMode:boolean}};
  if(!response.ok||!result.preview)throw new Error(result.error??`Smoke returned HTTP ${response.status}`);
  const report={testedAt:new Date().toISOString(),billingEnabled:false,status:response.status,model:'gemini-3.5-flash-lite',preview:result.preview,
    limitations:['Runs in local Workers runtime, not the deployed Free plan.','No LinkedIn publish, phone installation, or notification was performed.']};
  writeFileSync(new URL('../../.byline-local/cloud-live-smoke.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:true,status:response.status,title:result.preview.title,words:result.preview.text.split(/\s+/).length,testMode:result.preview.testMode}));
}finally {await runtime.dispose();}
