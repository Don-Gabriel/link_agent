import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { readEnvFile } from './live-env.mjs';
import { googleOperatorFetch } from './google-operator.mjs';
const original=readEnvFile('.env');
mkdirSync('.byline-local',{recursive:true});
const db=new pg.Pool({connectionString:'postgresql://byline_local@127.0.0.1:55440/postgres'});
try {if(!(await db.query("SELECT 1 FROM pg_database WHERE datname='byline_live'")).rowCount)await db.query('CREATE DATABASE byline_live');}finally{await db.end();}
if(!existsSync('.env.byline-live')) {
  const settings={DATABASE_URL:'postgresql://byline_local@127.0.0.1:55440/byline_live',PORT:'3000',BYLINE_PUBLIC_URL:'http://localhost:3000',
    APP_SECRET:randomBytes(32).toString('hex'),APP_PASSWORD:randomBytes(32).toString('hex'),TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),CRON_SECRET:randomBytes(32).toString('hex'),
    LINKEDIN_LIVE:'true',FCM_PROJECT_ID:'linkdin-43813',FCM_ACCESS_TOKEN_FILE:resolve('.byline-local/google-access.json'),BYLINE_ZERO_BUDGET_STATE_FILE:resolve('.byline-local/zero-budget.json'),
    BYLINE_AI_CALLS_PER_USER_DAY:'30',BYLINE_DEVICE_PAIRING:'true'};
  for(const key of ['GEMINI_API_KEY','LLM_PROVIDER','GEMINI_MODEL','GEMINI_FALLBACK_MODEL','GEMINI_LAST_RESORT_MODEL','GEMINI_RPD_LIMIT','LINKEDIN_CLIENT_ID','LINKEDIN_CLIENT_SECRET','LINKEDIN_REDIRECT_URI','LINKEDIN_API_VERSION','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'])settings[key]=original[key]??'';
  writeFileSync('.env.byline-live',Object.entries(settings).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
}
const r=await googleOperatorFetch('https://firebase.googleapis.com/v1beta1/projects/linkdin-43813/androidApps/1:433603846248:android:fd525192aa4e8c3ed71bdd/config');
if(!r.ok)throw new Error(`Could not read ByLine Firebase app configuration (${r.status}).`);
const config=JSON.parse(Buffer.from((await r.json()).configFileContents,'base64').toString('utf8'));
writeFileSync('.byline-local/firebase-live-google-services.json',JSON.stringify(config,null,2));
const client=config.client.find(c=>c.client_info.android_client_info.package_name==='com.linkdin.byline');
if(!client)throw new Error('Firebase configuration does not match ByLine.');
writeFileSync('.byline-local/live-dart-defines.json',JSON.stringify({BYLINE_APP_VARIANT:'live',BYLINE_API_URL:'http://localhost:3000',
  FIREBASE_API_KEY:client.api_key[0].current_key,FIREBASE_APP_ID:client.client_info.mobilesdk_app_id,FIREBASE_PROJECT_ID:config.project_info.project_id,FIREBASE_SENDER_ID:config.project_info.project_number},null,2));
console.log('Real-service configuration prepared in ignored local files. Original app and database unchanged.');
