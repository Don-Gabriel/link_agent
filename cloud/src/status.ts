import { ALL_CATEGORY_IDS,CATEGORIES } from '../../lib/categories';
import { PRESETS,MAX_HASHTAGS } from '../../lib/style';
import { formatInZone,localClock } from '../../lib/schedule';
import { loadAgent,accountStatus,postView,type CloudPost } from './models';
import { listSlots,slotView,SLOT_LIMITS } from './slots';
import { AI_MODEL,AI_FALLBACK_MODEL,PROVIDER_AI_LIMIT } from './ai';
import { json } from './http';
import type { Owner } from './auth';
import type { AppEnv } from './env';
export async function statusRoute(env:AppEnv,owner:Owner) {
  const {settings:agent}=await loadAgent(env.DB,owner.agentId);
  const [slots,account,posts,schedule,heartbeat,budget,calls,ambiguous,timeline,rejections,generation,setup]=await Promise.all([
    listSlots(env.DB,owner.agentId),accountStatus(env.DB,owner.agentId),
    env.DB.prepare(`SELECT * FROM (SELECT * FROM posts WHERE agent_id=? AND status IN ('draft','approved','failed','unknown','missed') ORDER BY seq DESC LIMIT 200)
      UNION ALL SELECT * FROM (SELECT * FROM posts WHERE agent_id=? AND status='published' ORDER BY published_at DESC LIMIT 20)`).bind(owner.agentId,owner.agentId).all<CloudPost>(),
    env.DB.prepare('SELECT last_run_at,cycle_count FROM scheduler_state WHERE agent_id=?').bind(owner.agentId).first<{last_run_at:string|null;cycle_count:number}>(),
    env.DB.prepare("SELECT value,updated_at FROM system_status WHERE key='cloud_scheduler'").first<{value:string;updated_at:string}>(),
    env.DB.prepare("SELECT source,count(*) AS n FROM distributions WHERE agent_id=? AND status='sent' AND send_day=? GROUP BY source").bind(owner.agentId,localClock(agent.timezone).date).all<{source:string;n:number}>(),
    env.DB.prepare('SELECT model,attempts AS calls FROM ai_provider_days WHERE day=?').bind(localClock('America/Los_Angeles').date).all<{model:string;calls:number}>(),
    env.DB.prepare("SELECT seq,status,last_error AS reason,created_at AS createdAt FROM distributions WHERE agent_id=? AND (status='unknown' OR (status='in_flight' AND created_at<?)) ORDER BY created_at DESC LIMIT 20").bind(owner.agentId,new Date(Date.now()-10*60000).toISOString()).all(),
    env.DB.prepare('SELECT r.*,s.local_time FROM slot_runs r JOIN post_slots s ON s.id=r.slot_id WHERE s.agent_id=? AND run_date>=? ORDER BY run_date DESC LIMIT 40').bind(owner.agentId,new Date(Date.now()-7*86400000).toISOString().slice(0,10)).all(),
    env.DB.prepare('SELECT title,url,reason,scores_json,created_at FROM rejections WHERE agent_id=? ORDER BY created_at DESC LIMIT 15').bind(owner.agentId).all<{title:string;url:string;reason:string;scores_json:string;created_at:string}>(),
    env.DB.prepare('SELECT id,state,stage,error,created_at AS createdAt,updated_at AS updatedAt FROM generation_jobs WHERE agent_id=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(owner.agentId).first(),
    env.DB.prepare('SELECT config FROM onboarding WHERE user_id=?').bind(owner.userId).first<{config:string}>(),
  ]);
  const next=slots.filter(s=>s.enabled&&s.next_run_at).map(s=>s.next_run_at!).sort()[0]??null;
  const age=heartbeat?Date.now()-Date.parse(heartbeat.updated_at):Infinity;
  return json({initialized:true,agent,account,generation,reviewDelivery:{config:{notifications:setup?JSON.parse(setup.config).notifications??'later':'later'}},
    config:{liveMode:env.LINKEDIN_LIVE==='true',encryptionKey:!!env.TOKEN_ENCRYPTION_KEY,memoryDegraded:false,maxAutoCap:5,maxHashtags:MAX_HASHTAGS,
      presets:Object.entries(PRESETS).map(([id,p])=>({id,label:p.label,blurb:p.blurb,style:p.style})),
      categories:ALL_CATEGORY_IDS.map(id=>({id,label:CATEGORIES[id].label,blurb:CATEGORIES[id].blurb,groupLabel:CATEGORIES[id].groupLabel}))},
    budget:{autoUsed:budget.results.find(r=>r.source==='auto')?.n??0,autoCap:agent.autoPublishCap,manualUsed:budget.results.find(r=>r.source==='manual')?.n??0,manualCap:40,linkedinDailyRequests:150},
    schedule:{lastRunAt:schedule?.last_run_at??null,nextRunAt:next,nextRunLocal:next?formatInZone(new Date(next),agent.timezone):null,cycleCount:schedule?.cycle_count??0},
    slots:slots.map(s=>slotView(s,agent.timezone)),slotLimits:SLOT_LIMITS,timeline:timeline.results.map(r=>({slotId:r.slot_id,localTime:r.local_time,runDate:r.run_date,scheduledFor:r.scheduled_for,outcome:r.outcome,postSeq:r.post_seq,detail:r.detail,generatedAt:r.generated_at})),
    scheduler:{healthy:age<16*60000,lastTickAt:heartbeat?.updated_at??null,minutesSince:Number.isFinite(age)?Math.floor(age/60000):null,staleAfterMinutes:16},
    watchdog:{lastAt:null,minutesSince:null},
    queue:posts.results.filter(p=>['draft','approved','failed','unknown','missed'].includes(p.status)).map(postView),history:posts.results.filter(p=>p.status==='published').slice(0,20).map(postView),
    rejections:rejections.results.map(r=>({title:r.title,url:r.url,reason:r.reason,scores:JSON.parse(r.scores_json),createdAt:r.created_at})),
    llm:calls.results.map(r=>({...r,cap:[AI_MODEL,AI_FALLBACK_MODEL].includes(r.model)?PROVIDER_AI_LIMIT:0})),ambiguous:ambiguous.results});
}
