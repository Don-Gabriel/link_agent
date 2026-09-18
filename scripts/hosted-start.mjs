import {spawn} from 'node:child_process';
const required=['DATABASE_URL','TOKEN_ENCRYPTION_KEY','APP_SECRET','CRON_SECRET','LINKEDIN_CLIENT_ID','LINKEDIN_CLIENT_SECRET'];
const missing=required.filter(key=>!process.env[key]);
if(missing.length)throw new Error(`Missing hosted configuration: ${missing.join(', ')}`);
process.env.BYLINE_PUBLIC_URL ||= process.env.RENDER_EXTERNAL_URL;
const origin=new URL(process.env.BYLINE_PUBLIC_URL??'');
if(origin.protocol!=='https:')throw new Error('The hosted client requires an HTTPS public URL.');
process.env.LINKEDIN_REDIRECT_URI ||= `${origin.origin}/api/linkedin/callback`;
process.env.PORT ||= '10000';
process.env.BYLINE_ALLOW_LEGACY_AUTH='false';
process.env.BYLINE_TEST_MODE='false';
process.env.BYLINE_LOCAL_ONLY='false';
process.env.BYLINE_REGISTRATION_MODE ||= 'invite';
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.BYLINE_ZERO_BUDGET_STATE_FILE;
function run(file,args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[file,...args],{stdio:'inherit',env:process.env,windowsHide:true});
    const stop=()=>child.kill('SIGTERM');
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
    child.once('error',reject);
    child.once('exit',code=>{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);code===0?resolve():reject(new Error(`Process exited with code ${code}`));});
  });
}
await run('node_modules/tsx/dist/cli.mjs',['scripts/migrate.ts']);
process.env.BYLINE_REQUIRE_MIGRATIONS='true';
await run('node_modules/next/dist/bin/next',['start','--hostname','0.0.0.0','--port',process.env.PORT]);
