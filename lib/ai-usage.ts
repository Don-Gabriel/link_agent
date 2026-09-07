import { AsyncLocalStorage } from 'node:async_hooks';
import { query } from './db';
import { sessionIdentity } from './auth';
const context=new AsyncLocalStorage<string>();
export async function withAgentUsage<T>(agentId:string,work:()=>Promise<T>) {
  const [agent]=await query<{owner_id:string|null}>('SELECT owner_id FROM agents WHERE id=$1',[agentId]);
  return context.run(agent?.owner_id??agentId,work);
}
export async function usageOwner() {
  if(context.getStore())return context.getStore()!;
  try {
    const {headers}=await import('next/headers');
    const h=await headers();
    const token=h.get('authorization')?.replace(/^Bearer /,'')??h.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('lc_session='))?.slice(11);
    return (await sessionIdentity(token))?.userId??'legacy-owner';
  }catch{return 'legacy-owner';}
}
export async function reserveUserCall(owner:string,day:string) {
  const configured=Number(process.env.BYLINE_AI_CALLS_PER_USER_DAY);
  const cap=Number.isFinite(configured)&&configured>0?Math.floor(configured):60;
  const rows=await query(`INSERT INTO ai_user_days(owner,day,requests) VALUES($1,$2,1)
    ON CONFLICT(owner,day) DO UPDATE SET requests=ai_user_days.requests+1 WHERE ai_user_days.requests<$3 RETURNING owner`,[owner,day,cap]);
  return rows.length>0;
}
export async function reserveProviderCall(model:string,day:string,cap:number) {
  const [slot]=await query<{next_at:Date}>(`INSERT INTO ai_provider_days(model,day,attempts,next_at) VALUES($1,$2,1,now()+interval '4 seconds')
    ON CONFLICT(model,day) DO UPDATE SET attempts=ai_provider_days.attempts+1,next_at=GREATEST(now(),ai_provider_days.next_at)+interval '4 seconds'
    WHERE ai_provider_days.attempts<$3 AND ai_provider_days.next_at<now()+interval '15 seconds' RETURNING next_at`,[model,day,Math.max(1,Math.floor(cap*.9))]);
  if(!slot)return false;
  const wait=slot.next_at.getTime()-Date.now()-4000;
  if(wait>0)await new Promise(r=>setTimeout(r,wait));
  return true;
}
export async function recordAiUsage(owner:string,model:string,success:boolean,input?:number,output?:number) {
  await query('INSERT INTO ai_usage(owner,model,success,input_tokens,output_tokens) VALUES($1,$2,$3,$4,$5)',[owner,model,success,input??null,output??null]);
}
