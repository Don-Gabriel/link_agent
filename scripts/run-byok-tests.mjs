import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {localEnv} from './local-env.mjs';

// Only the isolated local PostgreSQL installation is accepted. Every run gets
// its own disposable database; neither the preview nor live data is modified.
const env=localEnv();
const url=new URL(env.DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.port!=='55440'||url.username!=='byline_local')throw new Error('Local test database required.');
url.pathname='/postgres';
const admin=new pg.Client({connectionString:url.href});
const database=`byline_byok_${randomBytes(8).toString('hex')}`;
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname=`/${database}`;
  const testEnv={...env,DATABASE_URL:url.href,BYLINE_TEST_MODE:'false',BYLINE_LOCAL_ONLY:'false',
    BYLINE_ALLOW_LEGACY_AUTH:'false',BYLINE_REGISTRATION_MODE:'open',BYLINE_AI_CALLS_PER_USER_DAY:'4',
    BYLINE_GEMINI_MODELS:'gemini-3.5-flash-lite',GEMINI_API_KEY:'operator-key-must-never-be-used',
    TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_SECRET:randomBytes(32).toString('hex'),
    CRON_SECRET:randomBytes(24).toString('hex'),BYLINE_ZERO_BUDGET_STATE_FILE:'',BYLINE_REQUIRE_MIGRATIONS:'false'};
  const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/byok-test.ts'],{env:testEnv,stdio:'inherit',windowsHide:true});
  process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
} finally {
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end();
}
