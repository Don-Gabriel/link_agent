import {writeFileSync} from 'node:fs';
import {defaultSetup,generateSetupSample} from '../lib/onboarding';
import {checkCredentials} from '../lib/push';
import {getPool} from '../lib/db';
async function main(){
 const sample=await generateSetupSample({...defaultSetup,timezone:'Asia/Kolkata'});
 writeFileSync('.byline-local/live-sample.json',JSON.stringify(sample,null,2));
 console.log('Real Gemini sample:',sample.text.split(/\s+/).length,'words; sources:',sample.sources.length,'; fixture:',sample.testMode);
 console.log('Push credentials:',await checkCredentials());
 await getPool()?.end();
}
main().catch(e=>{console.error('Live smoke test failed:',e.message);process.exitCode=1;});
