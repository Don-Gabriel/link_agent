import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {complete} from '../lib/llm';
async function main(){
 mkdirSync('.byline-local',{recursive:true});
 process.env.GEMINI_API_KEY='not-a-real-key';
 process.env.BYLINE_TEST_MODE='false';
 process.env.BYLINE_ZERO_BUDGET_STATE_FILE='.byline-local/budget-test.json';
 const hash=createHash('sha256').update(process.env.GEMINI_API_KEY).digest('hex');
 for(const state of [
  {keyHash:hash,billingEnabled:true,verifiedUntil:Date.now()+60000},
  {keyHash:hash,billingEnabled:false,verifiedUntil:Date.now()-1},
  {keyHash:'wrong',billingEnabled:false,verifiedUntil:Date.now()+60000},
  {keyHash:hash,billingEnabled:false},
 ]) {
  writeFileSync(process.env.BYLINE_ZERO_BUDGET_STATE_FILE,JSON.stringify(state));
  assert.deepEqual(await complete({system:'test',user:'test'}),{ok:false,reason:'free_tier_verification_required'});
 }
 console.log('4 zero-budget fail-closed checks passed without making any AI request.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
