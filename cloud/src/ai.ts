import type { Completion } from '../../lib/llm-contract';
import { boundedText } from '../../lib/http-body';
import { localClock } from '../../lib/schedule';
import type { AppEnv } from './env';
import { serviceCompletion } from './ai-service';
import { isRetryableAiReason } from '../../lib/ai-compatible';

export const USER_AI_LIMIT=40;
export const PROVIDER_AI_LIMIT=100;
export const AI_MODEL='gemini-3.5-flash-lite';
export const AI_FALLBACK_MODEL='gemini-3.1-flash-lite';
export function modelReview(env:AppEnv):string[] {
  return env.AI_PROVIDER&&env.AI_PROVIDER!=='gemini'&&env.AI_REQUIRE_REVIEW!=='false'
    ? ['Review factual claims and personal experience before approving this AI-assisted draft.'] : [];
}
export const isTransientAiFailure=(reason:string)=>['provider_http_500','provider_http_502','provider_http_503','provider_http_504','provider_unavailable'].includes(reason);
export async function reserveAi(db:D1Database,owner:string,model:string,day:string,at=new Date(),userCap=USER_AI_LIMIT,providerCap=PROVIDER_AI_LIMIT) {
  const row=await db.prepare(`INSERT INTO ai_reservations(id,owner,model,day,created_at)
    SELECT ?,?,?,?,? WHERE COALESCE((SELECT requests FROM ai_user_days WHERE owner=? AND day=?),0)<?
      AND COALESCE((SELECT attempts FROM ai_provider_days WHERE model=? AND day=?),0)<?
      AND COALESCE((SELECT next_at FROM ai_provider_days WHERE model=? AND day=?),'')<?
    RETURNING id`).bind(crypto.randomUUID(),owner,model,day,at.toISOString(),owner,day,userCap,model,day,providerCap,model,day,new Date(at.getTime()+16000).toISOString()).first<{id:string}>();
  if(!row)return null;
  const counter=await db.prepare('SELECT next_at FROM ai_provider_days WHERE model=? AND day=?').bind(model,day).first<{next_at:string}>();
  return {id:row.id,waitMs:Math.max(0,Date.parse(counter!.next_at)-at.getTime()-4000)};
}
export function withProviderRetry(complete:Completion,wait:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms)),fallback:Completion=complete):Completion {
  return async args=>{
    const first=await complete(args);
    if(first.ok||!isTransientAiFailure(first.reason))return first;
    await wait(1500);
    return fallback(args);
  };
}
/** Every attempt reserves quota; transient failures get one bounded retry, never a paid fallback. */
export function completion(env:AppEnv,owner:string,operationId:string=crypto.randomUUID(),deadlineMs?:number):Completion {
  if(env.AI_PROVIDER==='compatible'||env.AI_PROVIDER==='workers-ai')return serviceCompletion(env,owner,operationId,deadlineMs);
  if(env.AI_PROVIDER&&env.AI_PROVIDER!=='gemini')return async()=>({ok:false,reason:'ai_configuration_invalid'});
  let remaining=12;
  const limited=(model:string):Completion=>{
    const single=singleCompletion(env,owner,model);
    return args=>remaining-->0?single(args):Promise.resolve({ok:false,reason:'ai_invocation_budget'});
  };
  // Both models are available on the existing free-tier project. Each actual
  // request reserves its author's allowance and that model's shared allowance.
  return withProviderRetry(limited(AI_MODEL),undefined,limited(AI_FALLBACK_MODEL));
}
/** Let the durable step retry temporary outages without re-fetching saved sources. */
export function durableCompletion(complete:Completion):Completion {
  return async args=>{
    const result=await complete(args);
    if(!result.ok&&(isTransientAiFailure(result.reason)||isRetryableAiReason(result.reason)))throw new Error(result.reason);
    return result;
  };
}
function singleCompletion(env:AppEnv,owner:string,model:string):Completion {
  return async args=>{
    if(!env.GEMINI_API_KEY)return {ok:false,reason:'missing_gemini_api_key'};
    const day=localClock('America/Los_Angeles').date;
    const reservation=await reserveAi(env.DB,owner,model,day);
    if(!reservation)return {ok:false,reason:'ai_allowance_or_pacing_limit'};
    if(reservation.waitMs)await new Promise(resolve=>setTimeout(resolve,reservation.waitMs));
    let success=false;
    let input:number|null=null,output:number|null=null;
    try {
      const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},signal:AbortSignal.timeout(45000),
        body:JSON.stringify({systemInstruction:{parts:[{text:args.system}]},contents:[{role:'user',parts:[{text:args.user}]}],
          generationConfig:{maxOutputTokens:Math.min(args.maxOutputTokens??2048,8192),...(args.jsonMode?{responseMimeType:'application/json'}:{})}}),
      });
      if(!response.ok){
        // Provider diagnostics stay in operator logs; never expose keys or raw
        // provider responses through the app's generation status.
        let detail='';
        try {
          const failure=JSON.parse(await boundedText(response,16384)) as {error?:{message?:string}};
          detail=(failure.error?.message??'').replaceAll(env.GEMINI_API_KEY,'[redacted]').slice(0,500);
        }catch { /* An invalid provider response is still a bounded failure. */ }
        console.warn(JSON.stringify({event:'ai_provider_rejected',model,status:response.status,detail}));
        return {ok:false,reason:response.status===429?'provider_quota_reached':`provider_http_${response.status}`};
      }
      const data=JSON.parse(await boundedText(response,128*1024)) as {candidates?:{finishReason?:string;content?:{parts?:{text?:string;thought?:boolean}[]}}[];usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number}};
      input=data.usageMetadata?.promptTokenCount??null; output=data.usageMetadata?.candidatesTokenCount??null;
      const candidate=data.candidates?.[0];
      const text=candidate?.content?.parts?.filter(p=>!p.thought).map(p=>p.text??'').join('')??'';
      if(!text.trim()||candidate?.finishReason!=='STOP')return {ok:false,reason:'incomplete_or_blocked_completion'};
      success=true;
      return {ok:true,text,model};
    }catch(error){
      const detail=(error instanceof Error?`${error.name}: ${error.message}`:'Unknown provider failure').replaceAll(env.GEMINI_API_KEY,'[redacted]').slice(0,500);
      console.warn(JSON.stringify({event:'ai_provider_failed',model,detail}));
      return {ok:false,reason:detail.includes('Too many subrequests')?'request_budget_exceeded':'provider_unavailable'};
    }
    finally {
      await env.DB.prepare('INSERT INTO ai_usage(owner,model,success,input_tokens,output_tokens) VALUES(?,?,?,?,?)').bind(owner,model,success?1:0,input,output).run();
    }
  };
}
