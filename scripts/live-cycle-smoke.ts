import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {provisionUser} from '../lib/native-auth';
import {defaultSetup,setupPersona,setupStyle} from '../lib/onboarding';
import {query,getPool} from '../lib/db';
import {runCycleWithLock} from '../lib/cycle';
async function main(){
  const user=await provisionUser('integration-test',randomUUID(),'ByLine integration test');
  const [agent]=await query<{id:string}>('SELECT id FROM agents WHERE owner_id=$1',[user]);
  try {
    await query(`UPDATE agents SET paused=false,categories_json=$2,style_json=$3,persona_json=$4 WHERE id=$1`,[agent.id,JSON.stringify(['emerging-tech','ai-ml','dev-tooling']),JSON.stringify(setupStyle(defaultSetup)),JSON.stringify(setupPersona(defaultSetup,'ByLine integration test'))]);
    const result=await runCycleWithLock(agent.id,true,{reviewDate:new Date().toISOString().slice(0,10),suppressNotification:true});
    writeFileSync('.byline-local/live-cycle-result.json',JSON.stringify(result,null,2));
    console.log('Real pipeline result:',JSON.stringify({ran:result.ran,drafted:result.drafted,published:result.published,reason:result.skippedReason,models:result.servedBy}));
    if(!result.drafted)process.exitCode=1;
  }finally{
    await query('UPDATE agents SET paused=true,active=false WHERE id=$1',[agent.id]);
    await getPool()?.end();
  }
}
main().catch(e=>{console.error('Pipeline verification failed:',e.message);process.exitCode=1;});
