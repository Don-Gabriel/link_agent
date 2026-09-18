import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {readEnvFile} from './live-env.mjs';

// Run locally. Creates a separate database on the existing Neon project; it
// never copies the personal installation's accounts, posts or Gemini key.
const target='.byline-release/render.env';
if(existsSync(target))throw new Error('Hosted configuration already exists. Preserve its encryption and signing keys.');
const original=readEnvFile('.env');
const url=new URL(original.DATABASE_URL);
if(!url.hostname.endsWith('.neon.tech'))throw new Error('This helper only supports the existing Neon project.');
const admin=new pg.Client({connectionString:url.href});
await admin.connect();
try {
  if((await admin.query("SELECT 1 FROM pg_database WHERE datname='byline_public'")).rowCount)
    throw new Error('byline_public already exists. Restore its original hosted configuration rather than generating new encryption keys.');
  await admin.query('CREATE DATABASE byline_public');
} finally {await admin.end();}
url.pathname='/byline_public';
const values={NODE_VERSION:'22',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',PORT:'10000',
  DATABASE_URL:url.href,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),
  APP_SECRET:randomBytes(32).toString('hex'),CRON_SECRET:randomBytes(24).toString('hex'),
  LINKEDIN_CLIENT_ID:original.LINKEDIN_CLIENT_ID,LINKEDIN_CLIENT_SECRET:original.LINKEDIN_CLIENT_SECRET,
  LINKEDIN_API_VERSION:original.LINKEDIN_API_VERSION||'202607',LINKEDIN_LIVE:'false',
  BYLINE_ALLOW_LEGACY_AUTH:'false',BYLINE_REGISTRATION_MODE:'invite',BYLINE_GEMINI_MODELS:'gemini-3.5-flash-lite',
  BYLINE_AI_CALLS_PER_USER_DAY:'60',BYLINE_TEST_MODE:'false',BYLINE_LOCAL_ONLY:'false'};
mkdirSync('.byline-release',{recursive:true});
writeFileSync(target,Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{flag:'wx',mode:0o600});
console.log('Created an empty ByLine client database and ignored .byline-release/render.env. No secret values printed.');
