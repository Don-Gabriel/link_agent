// Prepare ignored deployment secrets without echoing their values.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomBytes,createPrivateKey,sign} from 'node:crypto';
const read=name=>parseEnv(readFileSync(new URL(`../../${name}`,import.meta.url),'utf8'));
const local=read('.env');
const file=new URL('../../.byline-local/cloud-secrets.json',import.meta.url);
const saved=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
const fcm=JSON.parse(readFileSync(new URL('../../.byline-local/byline-cloud-fcm.json',import.meta.url),'utf8'));
if(fcm.project_id!=='linkdin-43813')throw new Error('Firebase project does not match the ByLine Android configuration');
if(!fcm.client_email||!fcm.private_key)throw new Error('FCM server credentials are missing');
const key=createPrivateKey(fcm.private_key),now=Math.floor(Date.now()/1000);
const b64=s=>Buffer.from(s).toString('base64url');
const jwt=`${b64(JSON.stringify({alg:'RS256',typ:'JWT'}))}.${b64(JSON.stringify({iss:fcm.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}))}`;
const result=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${jwt}.${sign('RSA-SHA256',Buffer.from(jwt),key).toString('base64url')}`}),signal:AbortSignal.timeout(15000)});
if(!result.ok)throw new Error(`FCM server credential verification failed (HTTP ${result.status})`);
const access=await result.json();
const dryRun=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(fcm.project_id)}/messages:send`,{
  method:'POST',headers:{Authorization:`Bearer ${access.access_token}`,'Content-Type':'application/json'},
  body:JSON.stringify({validate_only:true,message:{topic:'byline-deployment-validation',data:{kind:'configuration-check'}}}),signal:AbortSignal.timeout(15000)});
if(!dryRun.ok)throw new Error(`FCM send permission verification failed (HTTP ${dryRun.status})`);
await dryRun.body?.cancel();
const secrets={APP_SECRET:saved.APP_SECRET??randomBytes(32).toString('hex'),TOKEN_ENCRYPTION_KEY:saved.TOKEN_ENCRYPTION_KEY??randomBytes(32).toString('base64'),
  GEMINI_API_KEY:local.GEMINI_API_KEY,LINKEDIN_CLIENT_ID:local.LINKEDIN_CLIENT_ID,LINKEDIN_CLIENT_SECRET:local.LINKEDIN_CLIENT_SECRET,FCM_SERVICE_ACCOUNT_JSON:JSON.stringify(fcm),
  CRON_SECRET:saved.CRON_SECRET??randomBytes(32).toString('hex'),LINKEDIN_LIVE:saved.LINKEDIN_LIVE??'false'};
for(const [name,value] of Object.entries(secrets))if(!value)throw new Error(`${name} is missing`);
writeFileSync(file,JSON.stringify(secrets,null,2),{mode:0o600});
console.log(JSON.stringify({prepared:true,secretNames:Object.keys(secrets),firebaseProject:fcm.project_id,fcmCredentialsVerified:true,fcmSendPermissionVerified:true,notificationSent:false,publishingEnabled:secrets.LINKEDIN_LIVE==='true'}));
