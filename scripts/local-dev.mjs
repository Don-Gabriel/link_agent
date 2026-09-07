import { spawn } from 'node:child_process';
import { localEnv } from './local-env.mjs';
const env=localEnv();
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',env.PORT],{env,stdio:'inherit',windowsHide:true});
let busy=false;
const timer=setInterval(async()=>{if(busy)return;busy=true;try{
  await fetch(`http://127.0.0.1:${env.PORT}/api/cron/tick`,{headers:{'x-cron-secret':env.CRON_SECRET},signal:AbortSignal.timeout(20000)});
}catch{}finally{busy=false;}},30000);
server.on('exit',code=>{clearInterval(timer);process.exit(code??0);});
process.on('SIGINT',()=>{clearInterval(timer);server.kill();});
console.log('Local test mode: synthetic samples, no AI calls, no LinkedIn publishing.');
