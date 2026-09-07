import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {localEnv} from './local-env.mjs';
const env=localEnv();
const base=`http://127.0.0.1:${env.PORT}`;
async function request(path,token,body,method=body?'POST':'GET') {
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});
  return {status:response.status,data:await response.json()};
}
assert.equal((await request('/api/native-auth')).data.localTest,true,'requires isolated local mode');
const session=await request('/api/native-auth',null,{provider:'local',verifier:randomBytes(48).toString('base64url')});
assert.equal(session.status,200);
const token=session.data.token;
let setup=(await request('/api/onboarding',token)).data;
assert.ok(setup.categories.length>=1000);
const categories=['energy:solar-energy','music:spatial-audio','health:patient-safety'];
const config={...setup.config,industry:'energy',categories,topics:['Solar energy','Spatial audio','Patient safety'],voice:'analytical',voiceNotes:'Focus on practical evidence and explain unfamiliar terms.',style:{structure:'bullets',register:'accessible',minWords:80,maxWords:160,hashtagCount:0,emoji:'none',hook:'plain',cta:'soft',bannedPhrases:['game changer']},timezone:'Asia/Kolkata'};
let response=await request('/api/onboarding',token,{action:'save',revision:setup.revision,config});
assert.equal(response.status,200);setup=response.data;
assert.deepEqual(setup.config.categories,categories);assert.equal(setup.config.style.maxWords,160);
assert.equal((await request('/api/onboarding',token,{action:'save',revision:setup.revision,config:{...config,categories:['__proto__']}})).status,400);
setup=(await request('/api/onboarding',token,{action:'preview',revision:setup.revision})).data;
assert.equal(setup.preview.testMode,true);
setup=(await request('/api/onboarding',token,{action:'accept',revision:setup.revision})).data;
response=await request('/api/onboarding',token,{action:'finish',revision:setup.revision,time:'09:00',timezone:'Asia/Kolkata',notifications:'later'});
assert.equal(response.status,200);assert.ok(response.data.completed_at);
const status=(await request('/api/status',token)).data;
assert.deepEqual(status.agent.categories,categories);
assert.equal(status.agent.style.structure,'bullets');assert.equal(status.agent.style.hashtagCount,0);assert.equal(status.agent.style.minWords,80);
assert.ok(status.agent.style.customRules.some(s=>s.includes('practical evidence')));
assert.deepEqual((await request('/api/interests',token)).data.topics,config.topics);
for(const invalid of [[],['constructor'],Array(13).fill(categories[0])]) {
  assert.equal((await request('/api/settings',token,{categories:invalid},'PATCH')).status,400);
}
assert.equal((await request('/api/settings',token,{categories:['agriculture:soil-health']},'PATCH')).status,200);
const changed=(await request('/api/status',token)).data;
assert.deepEqual(changed.agent.categories,['agriculture:soil-health']);
assert.ok(changed.agent.domain.includes('soil health'));
assert.equal(changed.agent.style.structure,'bullets','changing subjects preserves voice');
console.log('Local API checks passed: 1,000+ catalogue, cross-industry selection, onboarding completion, persisted voice, topic edits and invalid-selection rejection. No external publishing or model calls.');
