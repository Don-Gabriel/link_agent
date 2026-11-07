import { body,json,HttpError,responseJson } from './http';
import { boundedText } from '../../lib/http-body';
import type { AppEnv } from './env';
import type { Owner } from './auth';
import type { GenerationJob } from './jobs';
export function draftNoticeTime(job:GenerationJob,leadMinutes:number,now=Date.now()) {
  const reviewAt=job.kind==='slot'&&!job.requested&&job.scheduledFor?Date.parse(job.scheduledFor)-leadMinutes*60000:now;
  return new Date(Math.max(now,Number.isFinite(reviewAt)?reviewAt:now)).toISOString();
}
const b64=(s:string|Uint8Array)=>btoa(typeof s==='string'?s:Array.from(s,b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
interface ServiceAccount {project_id:string;client_email:string;private_key:string}
async function pushCredentials(env:AppEnv) {
  if(!env.FCM_SERVICE_ACCOUNT_JSON)return null;
  const account=JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  const now=Math.floor(Date.now()/1000),payload=`${b64(JSON.stringify({alg:'RS256',typ:'JWT'}))}.${b64(JSON.stringify({iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}))}`;
  const bytes=Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',bytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const sig=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(payload)));
  const result=await responseJson<{access_token:string}>(await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${payload}.${b64(sig)}`}),signal:AbortSignal.timeout(12000)}));
  return {project:account.project_id,token:result.access_token};
}
export interface Notice {kind:string;seq?:number;detail?:string}
function notification(n:Notice) {
  if(n.kind==='draft_ready')return {title:'A draft is ready to read',body:n.detail??`Your draft${n.seq?` #${n.seq}`:''} is ready for review.`};
  if(n.kind==='published')return {title:'Posted to LinkedIn',body:`Post #${n.seq} went out.`};
  if(n.kind==='token_expiring')return {title:'Reconnect LinkedIn',body:'Your LinkedIn connection is expiring. Open ByLine to reconnect.'};
  if(n.kind==='test')return {title:'Notifications are working',body:'ByLine can now notify this device.'};
  if(n.kind==='draft_failed')return {title:'Your draft needs attention',body:n.detail??'Preparation could not finish. Open ByLine to try again.'};
  return {title:'ByLine needs your attention',body:n.detail??'Open ByLine to review the latest status.'};
}
export async function notify(env:AppEnv,agentId:string,event:Notice,target?:string) {
  return (await deliver(env,agentId,event,[],target)).delivered;
}
async function deliver(env:AppEnv,agentId:string,event:Notice,accepted:string[],target?:string) {
  const devices=(await env.DB.prepare('SELECT token FROM device_tokens WHERE agent_id=? AND (? IS NULL OR token=?) LIMIT 10').bind(agentId,target??null,target??null).all<{token:string}>()).results;
  const pending=devices.filter(d=>!accepted.includes(d.token));
  if(!pending.length)return {delivered:0,accepted,complete:true};
  const auth=await pushCredentials(env);if(!auth)return {delivered:0,accepted,complete:false};
  let delivered=0;
  const settled=new Set(accepted);
  for(const {token} of pending) {
    try {
      const response=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(auth.project)}/messages:send`,{method:'POST',headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),
        body:JSON.stringify({message:{token,notification:notification(event),data:{kind:event.kind,tab:'queue',...(event.seq?{seq:String(event.seq)}:{})},
          android:{priority:'HIGH',collapse_key:`byline-${event.kind}-${event.seq??''}`,notification:{channel_id:event.kind==='draft_ready'?'linkdin_updates':'linkdin_alerts',tag:`byline-${event.kind}-${event.seq??''}`}}}})});
      if(response.ok){delivered++;settled.add(token);await response.body?.cancel();}
      else {
        const failure=await boundedText(response,16384);
        if(response.status===404&&failure.includes('UNREGISTERED')) {
          await env.DB.prepare('DELETE FROM device_tokens WHERE agent_id=? AND token=?').bind(agentId,token).run();
          settled.add(token);
        }
      }
    }catch { /* The durable outbox retries later. Never log tokens. */ }
  }
  return {delivered,accepted:[...settled],complete:devices.every(d=>settled.has(d.token))};
}
export async function devicesRoute(request:Request,env:AppEnv,owner:Owner) {
  // Older Android releases send DELETE's token in the query string.
  const b=request.method==='DELETE'&&!request.body
    ?{token:new URL(request.url).searchParams.get('token')}:await body(request);
  if(request.method==='DELETE') {
    if(typeof b.token==='string')await env.DB.prepare('DELETE FROM device_tokens WHERE token=? AND agent_id=?').bind(b.token,owner.agentId).run();
    return json({ok:true});
  }
  if(b.action==='test') {
    const delivered=await notify(env,owner.agentId,{kind:'test'},typeof b.token==='string'?b.token:undefined);
    return json(delivered?{ok:true,delivered}:{error:'No notification could be delivered. Enable notifications on this device first.'},delivered?200:503);
  }
  if(typeof b.token!=='string'||b.token.length<20||b.token.length>4096)throw new HttpError(400,'Invalid notification token.');
  const platform=typeof b.platform==='string'?b.platform.slice(0,30):'android';
  await env.DB.prepare(`INSERT INTO device_tokens(token,agent_id,platform) VALUES(?,?,?)
    ON CONFLICT(token) DO UPDATE SET agent_id=excluded.agent_id,platform=excluded.platform,last_seen_at=?`).bind(b.token,owner.agentId,platform,new Date().toISOString()).run();
  return json({ok:true,configured:!!env.FCM_SERVICE_ACCOUNT_JSON});
}
export async function drainNotifications(env:AppEnv,dedupeKey?:string) {
  if(!env.FCM_SERVICE_ACCOUNT_JSON)return;
  // Claim with a future retry time so concurrent ticks do not immediately resend.
  const rows=await env.DB.prepare(`UPDATE notification_outbox SET attempts=attempts+1,retry_at=? WHERE id IN
    (SELECT id FROM notification_outbox WHERE delivered_at IS NULL AND retry_at<=? AND attempts<5 AND (? IS NULL OR dedupe_key=?) ORDER BY id LIMIT 3) RETURNING id,agent_id,payload,delivered_tokens_json`)
    .bind(new Date(Date.now()+10*60000).toISOString(),new Date().toISOString(),dedupeKey??null,dedupeKey??null).all<{id:number;agent_id:string;payload:string;delivered_tokens_json:string}>();
  for(const row of rows.results) {
    try {
      const event=JSON.parse(row.payload) as Notice;
      if(event.kind==='draft_ready'&&event.seq) {
        const post=await env.DB.prepare('SELECT status FROM posts WHERE agent_id=? AND seq=?').bind(row.agent_id,event.seq).first<{status:string}>();
        if(post&&['published','rejected','unknown'].includes(post.status)) {
          await env.DB.prepare('UPDATE notification_outbox SET delivered_at=? WHERE id=?').bind(new Date().toISOString(),row.id).run();
          continue;
        }
      }
      const result=await deliver(env,row.agent_id,event,JSON.parse(row.delivered_tokens_json));
      await env.DB.prepare('UPDATE notification_outbox SET delivered_at=?,delivered_tokens_json=?,retry_at=? WHERE id=?')
        .bind(result.complete?new Date().toISOString():null,JSON.stringify(result.accepted),new Date(Date.now()+60000).toISOString(),row.id).run();
    }catch {
      await env.DB.prepare('UPDATE notification_outbox SET retry_at=? WHERE id=?').bind(new Date(Date.now()+60000).toISOString(),row.id).run();
      console.warn(JSON.stringify({event:'notification_delivery_deferred',notice:row.id}));
    }
  }
}
