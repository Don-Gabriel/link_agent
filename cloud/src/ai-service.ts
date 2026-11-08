import { compatibleConfig, compatibleComplete, isRetryableAiReason, positiveInteger } from '../../lib/ai-compatible';
import type { Completion, CompleteResult } from '../../lib/llm-contract';
import { digest, encryptToken, decryptToken } from './crypto';
import type { AppEnv } from './env';
import { workersAiConfig,workersAiComplete } from './ai-workers';

interface RequestRow {state:string;lease_until:number;retry_at:number;attempts:number;result_enc:string|null;reason:string|null}
export async function aiAllowance(env:AppEnv,owner:string,at=new Date()) {
  const rule=await env.DB.prepare('SELECT * FROM ai_account_limits WHERE owner=?').bind(owner)
    .first<{plan_key:string;daily_attempt_limit:number;max_parallel:number;enabled:number;expires_at:string|null}>();
  const day=at.toISOString().slice(0,10);
  const used=await env.DB.prepare('SELECT attempts FROM ai_service_days WHERE owner=? AND day=?').bind(owner,day).first<{attempts:number}>();
  return {plan:rule?.plan_key??'pilot',unit:'inference_attempts',day,used:used?.attempts??0,
    limit:rule?.daily_attempt_limit??positiveInteger(env.AI_DAILY_ATTEMPT_LIMIT,40,100000),maxParallel:rule?.max_parallel??1,
    enabled:rule?!!rule.enabled&&(!rule.expires_at||rule.expires_at>at.toISOString()):true};
}

/** Distributed admission, request replay and fencing live in D1, not process memory.
 * A successful response is encrypted; prompts are never persisted here.
 * Exactly-once GPU execution is impossible after an ambiguous network failure.
 * Replays reuse a stored response, and late workers cannot overwrite a newer lease.
 */
export function serviceCompletion(env:AppEnv,owner:string,operationId:string,deadlineMs?:number):Completion {
  return async args=>{
    let config;
    try { config=env.AI_PROVIDER==='workers-ai'?workersAiConfig(env):compatibleConfig(env); } catch { return {ok:false,reason:'ai_configuration_invalid'}; }
    let maxParallel:number;
    try { maxParallel=positiveInteger(env.AI_MAX_CONCURRENCY,1,256); } catch { return {ok:false,reason:'ai_configuration_invalid'}; }
    if(deadlineMs!==undefined) {
      const remaining=deadlineMs-Date.now();
      if(remaining<1000)return {ok:false,reason:'ai_deadline_exceeded'};
      config={...config,timeoutMs:Math.min(config.timeoutMs,remaining)};
    }
    const now=Date.now(),day=new Date(now).toISOString().slice(0,10);
    const allowance=await aiAllowance(env,owner,new Date(now));
    if(!allowance.enabled)return {ok:false,reason:'ai_access_disabled'};
    // Include configuration/prompt in identity so a model rollout cannot replay the old answer.
    const route=await digest(JSON.stringify([config.baseUrl,config.model]));
    const id=await digest(JSON.stringify([owner,operationId,route,config.disableThinking,args]));
    const existing=await env.DB.prepare('SELECT state,lease_until,retry_at,attempts,result_enc,reason FROM ai_requests WHERE id=?').bind(id).first<RequestRow>();
    if(existing?.state==='succeeded'&&existing.result_enc) {
      return JSON.parse(await decryptToken(env.TOKEN_ENCRYPTION_KEY,existing.result_enc)) as CompleteResult;
    }
    if(existing?.state==='failed')return {ok:false,reason:existing.reason??'ai_attempts_exhausted'};
    if(existing&&existing.attempts>=3&&existing.lease_until<=now)return {ok:false,reason:'ai_attempts_exhausted'};
    if(existing?.state==='running'&&existing.lease_until>now)return {ok:false,reason:'ai_busy'};
    if(existing&&existing.retry_at>now)return {ok:false,reason:'ai_retry_later',retryAfterMs:existing.retry_at-now};
    if(allowance.used>=allowance.limit)return {ok:false,reason:'daily_ai_allowance_reached'};
    const operation=await env.DB.prepare('SELECT COALESCE(sum(attempts),0) AS n FROM ai_requests WHERE owner=? AND operation_id=?')
      .bind(owner,operationId).first<{n:number}>();
    if(operation&&operation.n>=12)return {ok:false,reason:'ai_invocation_budget'};
    const health=await env.DB.prepare('SELECT blocked_until FROM ai_service_health WHERE route=?').bind(route).first<{blocked_until:number}>();
    if(health&&health.blocked_until>now)return {ok:false,reason:'ai_circuit_open',retryAfterMs:health.blocked_until-now};
    const lease=crypto.randomUUID();
    const claimed=await env.DB.prepare(`INSERT INTO ai_requests(id,owner,operation_id,route,state,lease,lease_until,day,created_at,updated_at)
      SELECT ?,?,?,?,'running',?,?,?,?,? WHERE
      EXISTS(SELECT 1 FROM byline_users WHERE id=?)
      AND COALESCE((SELECT attempts FROM ai_service_days WHERE owner=? AND day=?),0)<COALESCE((SELECT daily_attempt_limit FROM ai_account_limits WHERE owner=?),?)
      AND NOT EXISTS(SELECT 1 FROM ai_account_limits WHERE owner=? AND (enabled=0 OR (expires_at IS NOT NULL AND expires_at<=?)))
      AND COALESCE((SELECT blocked_until FROM ai_service_health WHERE route=?),0)<=?
      AND (SELECT count(*) FROM ai_requests WHERE route=? AND state='running' AND lease_until>?)<?
      AND (SELECT count(*) FROM ai_requests WHERE owner=? AND state='running' AND lease_until>?)<COALESCE((SELECT max_parallel FROM ai_account_limits WHERE owner=?),?)
      AND COALESCE((SELECT sum(attempts) FROM ai_requests WHERE owner=? AND operation_id=?),0)<12
      ON CONFLICT(id) DO UPDATE SET state='running',lease=excluded.lease,lease_until=excluded.lease_until,
        attempts=ai_requests.attempts+1,day=excluded.day,updated_at=excluded.updated_at
      WHERE ai_requests.state IN ('running','retry') AND ai_requests.lease_until<=? AND ai_requests.retry_at<=? AND ai_requests.attempts<3
      RETURNING id`).bind(id,owner,operationId,route,lease,now+config.timeoutMs+15000,day,now,now,
        owner,owner,day,owner,allowance.limit,owner,new Date(now).toISOString(),route,now,route,now,maxParallel,owner,now,owner,allowance.maxParallel,owner,operationId,now,now).first();
    if(!claimed)return {ok:false,reason:'ai_busy'};
    const result=await (env.AI_PROVIDER==='workers-ai'?workersAiComplete(env,config,args,id):compatibleComplete(config,args,id));
    const ended=Date.now(),retryable=!result.ok&&isRetryableAiReason(result.reason);
    const dailyQuota=!result.ok&&result.reason==='provider_quota_reached';
    const delay=dailyQuota?86400000-ended%86400000:!result.ok?(result.retryAfterMs??15000):0;
    const state=result.ok?'succeeded':retryable?'retry':'failed';
    const encoded=result.ok?await encryptToken(env.TOKEN_ENCRYPTION_KEY,JSON.stringify(result)):null;
    const committed=await env.DB.batch([
      env.DB.prepare(`UPDATE ai_requests SET state=?,lease_until=0,retry_at=?,result_enc=?,reason=?,updated_at=? WHERE id=? AND lease=? AND state='running'`)
        .bind(state,retryable?ended+delay:0,encoded,result.ok?null:result.reason,ended,id,lease),
      env.DB.prepare(`INSERT INTO ai_usage(owner,model,success,input_tokens,output_tokens,neurons)
        SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ai_requests WHERE id=? AND lease=? AND state=?)`)
        .bind(owner,config.model,result.ok?1:0,result.ok?result.usage?.inputTokens??null:null,result.ok?result.usage?.outputTokens??null:null,result.ok?result.usage?.neurons??null:null,id,lease,state),
    ]);
    if(!committed[0].meta.changes)return {ok:false,reason:'ai_busy'};
    if(result.ok) {
      await env.DB.prepare(`UPDATE ai_service_health SET failures=0,blocked_until=0,updated_at=? WHERE route=? AND updated_at<=?`).bind(ended,route,now).run();
    }else if(retryable||dailyQuota) {
      await env.DB.prepare(`INSERT INTO ai_service_health(route,failures,blocked_until,updated_at) VALUES(?,1,?,?)
        ON CONFLICT(route) DO UPDATE SET failures=failures+1,blocked_until=MAX(blocked_until,?),updated_at=?`)
        .bind(route,ended+delay,ended,ended+delay,ended).run();
    }
    console.info(JSON.stringify({event:'ai_request_finished',request:id,model:config.model,ok:result.ok,latencyMs:ended-now,...(!result.ok?{reason:result.reason}:{})}));
    return result;
  };
}
