import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { localEnv } from './local-env.mjs';
import pg from 'pg';
const env=localEnv();const base=`http://127.0.0.1:${env.PORT}`;
// Each run has its own synthetic client so repeated tests do not throttle the phone.
const testClient=`2001:db8:${randomBytes(8).toString('hex').match(/.{4}/g).join(':')}::1`;
let passed=0;
function check(value,message){assert.ok(value,message);passed++;console.log(`ok ${message}`);}
async function api(path,token,body,method=body?'POST':'GET') {
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Forwarded-For':testClient,...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();return {status:response.status,data};
}
async function today(token){return (await api('/api/review-delivery',token)).data;}
async function waitForDraft(token) {
  const deadline=Date.now()+30000;
  while(Date.now()<deadline) {
    const day=await today(token);
    const post=day.entries?.find(entry=>entry.post)?.post;
    if(post)return post;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Timetable worker did not produce a local draft within 30 seconds.');
}
const local=await api('/api/native-auth');check(local.data.localTest===true&&!local.data.google&&!local.data.linkedin,'isolated test mode has no external providers');
async function signup(){const r=await api('/api/native-auth',null,{provider:'local',verifier:randomBytes(48).toString('base64url')});assert.equal(r.status,200);return r.data.token;}
const a=await signup(),b=await signup();check(a!==b,'two accounts receive different sessions');
const sa=(await api('/api/status',a)).data,sb=(await api('/api/status',b)).data;
check(sa.agent.agentId!==sb.agent.agentId,'two accounts own different agents');
check(sa.slots.length===0&&sb.slots.length===0,'reading status does not activate schedules');
check((await api('/api/status')).status===401,'anonymous access is rejected');
check((await api('/api/status',a+'junk')).status===401,'tampered session is rejected');
let setup=(await api('/api/onboarding',a)).data;
const config={...setup.config,timezone:'Asia/Kolkata',time:'09:00',voiceNotes:'Write warmly and directly. Avoid jargon and sales language.'};
check((await api('/api/onboarding',a,{action:'finish',revision:setup.revision,...config})).status===400,'activation requires a reviewed sample');
setup=(await api('/api/onboarding',a,{action:'save',revision:setup.revision,config})).data;
check(setup.config.voiceNotes===config.voiceNotes,'custom voice instructions survive setup save');
check((await api('/api/onboarding',a,{action:'save',revision:setup.revision,config:{...config,voiceNotes:42}})).status===400,'invalid voice instructions are rejected');
setup=(await api('/api/onboarding',a,{action:'preview',revision:setup.revision})).data;
check(setup.preview.testMode&&setup.preview.sources.length>0,'sample is explicitly marked local and includes source context');
check((await api('/api/status',a)).data.queue.length===0,'preview does not consume the daily queue');
const old=setup.revision;
setup=(await api('/api/onboarding',a,{action:'save',revision:old,config:{...config,voice:'punchy'}})).data;
check(setup.preview===null,'changing voice invalidates the previous preview');
check((await api('/api/onboarding',a,{action:'accept',revision:old})).status===400,'stale sample cannot be accepted');
setup=(await api('/api/onboarding',a,{action:'preview',revision:setup.revision})).data;
setup=(await api('/api/onboarding',a,{action:'accept',revision:setup.revision})).data;
setup=(await api('/api/onboarding',a,{action:'finish',revision:setup.revision,time:'09:00',timezone:'Asia/Kolkata',notifications:'later'})).data;
check(!!setup.completed_at&&Date.parse(setup.next_delivery_at)>Date.now(),'completion records a real next delivery');
const completed=await api('/api/onboarding',a,{action:'finish',revision:setup.revision,time:'09:00',timezone:'Asia/Kolkata',notifications:'later'});
check(completed.data.next_delivery_at===setup.next_delivery_at,'completion is idempotent');
check(!(await api('/api/onboarding',b)).data.completed_at,'second account stays unactivated');
check((await api('/api/review-delivery',b,{action:'generate'})).status===409,'manual generation cannot bypass setup');
check((await api('/api/review-delivery',a,{action:'test-now'})).status===409,'retired daily endpoint directs clients to Timetable');
check((await api('/api/review-delivery',a,{action:'generate'})).status===202,'timetable worker accepts preparation asynchronously');
const first=await waitForDraft(a);
check((await api('/api/status',a)).data.queue.some(p=>p.seq===first.seq),'generated draft appears in the queue');
const day=await today(a);
const slotId=day.entries.find(entry=>entry.post?.seq===first.seq).slotId;
check(day.total===1&&day.ready===1,'onboarding creates one timetable entry with a ready draft');
const repeated=(await api('/api/review-delivery',a,{action:'generate'})).data;
check(!repeated.accepted&&repeated.count===0,'manual preparation does not queue a duplicate');
const existing=(await today(a)).entries[0].post;
check(existing.seq===first.seq&&existing.status==='draft'&&existing.text===first.text,'timetable retains the exact existing draft');
check((await today(b)).entries.length===0,'timetable readout is isolated between accounts');
check((await api('/api/posts/'+first.seq,a,{action:'discard'},'PATCH')).status===200,'daily suggestion can be skipped');
const skipped=(await api('/api/review-delivery',a,{action:'generate'})).data;
check(!skipped.accepted&&skipped.count===0,'repeat preparation does not replace a skipped post');
check((await today(a)).entries[0].post.status==='rejected','skipped timetable state remains visible after reloading');
check((await api('/api/posts/'+first.seq,a,{action:'edit',text:first.text,hashtags:first.hashtags},'PATCH')).status===200,'explicit editing can restore the skipped fixture draft');
check((await api('/api/posts/'+first.seq,a,{action:'publish',reviewed:{text:first.text+' stale version',hashtags:first.hashtags,media:first.media}},'PATCH')).status!==200,'approval refuses a post whose text differs from the reviewed version');
check((await api('/api/posts/'+first.seq,b,{action:'discard'},'PATCH')).status===404,'another account cannot edit the draft');
await api('/api/review-delivery',a,{action:'generate'});
check((await api('/api/status',a)).data.queue.length===1,'duplicate daily run does not create another draft');
const concurrent=await Promise.all(Array.from({length:8},(_,i)=>api('/api/posts',a,{text:`Concurrent test draft number ${i} contains enough words to be saved.`})));
check(concurrent.every(r=>r.status===200)&&new Set(concurrent.map(r=>r.data.seq)).size===8,'simultaneous composer saves allocate unique sequences');
check((await api('/api/posts/'+first.seq,a,{action:'publish',reviewed:{text:first.text,hashtags:first.hashtags,media:first.media}},'PATCH')).status===200,'one-tap approval works in local simulation');
check((await api('/api/status',a)).data.history.some(p=>p.seq===first.seq),'simulated approval reaches archive');
const published=(await api('/api/review-delivery',a,{action:'generate'})).data;
check(!published.accepted&&published.count===0,'repeat preparation cannot replace the published post');
check((await today(a)).entries[0].post.status==='published','published timetable state remains visible after reloading');
check((await api('/api/posts/'+first.seq,a,{action:'publish'},'PATCH')).status!==200,'repeated approval cannot republish');
check((await api('/api/review-delivery',b,{action:'schedule',time:'10:00',timezone:'UTC'})).status===409,'delivery settings cannot bypass onboarding');
check((await api('/api/slots/'+slotId,b,{localTime:'10:15'},'PATCH')).status===404,'another account cannot edit the timetable entry');
check((await api('/api/slots/'+slotId,a,{localTime:'10:15'},'PATCH')).status===200,'posting time can be changed in Timetable');
check((await api('/api/slots/'+slotId,a,{localTime:'25:00'},'PATCH')).status===400,'invalid posting time is rejected');
check((await api('/api/slots/'+slotId,a,{localTime:'09:07'},'PATCH')).status===200,'exact posting minutes are preserved');
check((await api('/api/slots',a)).data.slots.find(slot=>slot.id===slotId).localTime==='09:07','exact posting time persists on reload');
const priorTopicsB=(await api('/api/interests',b)).data.topics;
const priorStatus=(await api('/api/status',a)).data;
check((await api('/api/interests')).status===401,'interests require authentication');
check((await api('/api/interests',a,{topics:['Sustainable product design','Human-centred AI']})).status===200,'custom topics can be saved without presets');
check(JSON.stringify((await api('/api/interests',a)).data.topics)===JSON.stringify(['Sustainable product design','Human-centred AI']),'custom topics persist on reload');
check(JSON.stringify((await api('/api/interests',b)).data.topics)===JSON.stringify(priorTopicsB),'custom topics are isolated between accounts');
for (const topics of [[],['AI','ai'],['x'],[42],Array(13).fill('topic')]) {
  check((await api('/api/interests',a,{topics})).status===400,'invalid or duplicate interests are rejected');
}
const afterStatus=(await api('/api/status',a)).data;
check(priorStatus.agent.style.customRules.includes(config.voiceNotes),'custom voice instructions reach the daily writer style');
check(JSON.stringify(afterStatus.agent.style)===JSON.stringify(priorStatus.agent.style)&&JSON.stringify(afterStatus.agent.categories)===JSON.stringify(priorStatus.agent.categories),'changing topics preserves voice and source categories');
await api('/api/auth',b,null,'DELETE');
check((await api('/api/onboarding',b)).status===401,'revoked session cannot access account');
const db=new pg.Pool({connectionString:env.DATABASE_URL});
const noCalls=await db.query('SELECT count(*)::int AS n FROM llm_calls');check(noCalls.rows[0].n===0,'test flow made no Gemini calls');
const noSends=await db.query('SELECT count(*)::int AS n FROM distributions');check(noSends.rows[0].n===0,'test flow made no LinkedIn sends');
await db.end();
console.log(`${passed} ByLine integration checks passed. Test records remain in the isolated local database.`);
