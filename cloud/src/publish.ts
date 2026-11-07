import { createPost,postPermalink,type PostImage } from '../../lib/linkedin';
import { assemblePost,checkLength } from '../../lib/format';
import { localClock } from '../../lib/schedule';
import { decryptToken } from './crypto';
import { HttpError } from './http';
import { loadAgent,type CloudPost } from './models';
import type { AppEnv } from './env';
export type Reviewed={text:string;hashtags:string[];media:string[]};
export async function usableToken(env:AppEnv,agentId:string) {
  const account=await env.DB.prepare('SELECT member_urn,access_token_enc,expires_at FROM linkedin_accounts WHERE agent_id=?').bind(agentId).first<{member_urn:string;access_token_enc:string;expires_at:string}>();
  if(!account||Date.parse(account.expires_at)<=Date.now()+60000)throw new HttpError(409,'Reconnect LinkedIn before publishing.');
  return {token:await decryptToken(env.TOKEN_ENCRYPTION_KEY,account.access_token_enc),memberUrn:account.member_urn};
}
export async function ownedImages(db:D1Database,agentId:string,ids:unknown):Promise<PostImage[]> {
  if(!Array.isArray(ids)||ids.length>20||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new HttpError(400,'Invalid images.');
  if(!ids.length)return [];
  const rows=(await db.prepare(`SELECT id,linkedin_urn,alt_text FROM media_assets WHERE agent_id=? AND status='uploaded' AND id IN (${ids.map(()=>'?').join(',')})`).bind(agentId,...ids).all<{id:string;linkedin_urn:string;alt_text:string|null}>()).results;
  if(rows.length!==ids.length)throw new HttpError(400,'An image is unavailable or belongs to another account.');
  return ids.map(id=>{const row=rows.find(r=>r.id===id)!;return {imageUrn:row.linkedin_urn,altText:row.alt_text??undefined};});
}
export async function publish(env:AppEnv,agentId:string,seq:number,source:'manual'|'auto'='manual',reviewed?:Reviewed) {
  if(env.LINKEDIN_LIVE!=='true')throw new HttpError(409,'LinkedIn publishing has not been enabled on this deployment.');
  const {settings:agent}=await loadAgent(env.DB,agentId);
  const post=await env.DB.prepare('SELECT * FROM posts WHERE agent_id=? AND seq=?').bind(agentId,seq).first<CloudPost>();
  if(!post)throw new HttpError(404,'Post not found.');
  const hashtags=JSON.parse(post.hashtags_json??'[]'),media=JSON.parse(post.media_json??'[]');
  if(reviewed&&(reviewed.text!==post.text||JSON.stringify(reviewed.hashtags)!==JSON.stringify(hashtags)||JSON.stringify(reviewed.media)!==JSON.stringify(media)))throw new HttpError(409,'This post changed. Refresh and review it again.');
  const credentials=await usableToken(env,agentId),images=await ownedImages(env.DB,agentId,media);
  const text=assemblePost({body:post.text,hashtags,maxHashtags:15,sourceUrl:media.length?undefined:JSON.parse(post.sources_json??'[]')[0]});
  if(!checkLength(text).withinLimit)throw new HttpError(400,'This post exceeds LinkedIn’s text limit.');
  const now=new Date().toISOString(),day=localClock(agent.timezone).date,key=`linkedin:${agentId}:${seq}`;
  const eligible=`p.status IN ('draft','approved','failed','missed') AND p.text=? AND p.hashtags_json=? AND p.media_json=? AND a.active=1
    AND (?='manual' OR (a.paused=0 AND p.scheduled_for<=? AND p.scheduled_for>=?
      AND (p.hold_until IS NULL OR p.hold_until<=?) AND (p.cleared_at IS NOT NULL OR (a.auto_publish=1 AND s.auto_publish=1 AND s.enabled=1 AND p.review_notes_json='[]' AND p.requires_review=0))))`;
  const claim=await env.DB.prepare(`INSERT INTO distributions(agent_id,seq,idempotency_key,source,send_day,status,attempts)
    SELECT p.agent_id,p.seq,?,?,?,'in_flight',1 FROM posts p JOIN agents a ON a.id=p.agent_id LEFT JOIN post_slots s ON s.id=p.slot_id
    WHERE p.agent_id=? AND p.seq=? AND ${eligible}
      AND (SELECT COALESCE(SUM(attempts),0) FROM distributions WHERE agent_id=? AND source=? AND send_day=?)<?
    ON CONFLICT(idempotency_key) DO UPDATE SET status='in_flight',attempts=attempts+1,last_error=NULL,created_at=?,settled_at=NULL,source=excluded.source,send_day=excluded.send_day
      WHERE distributions.status='failed' RETURNING id`)
    .bind(key,source,day,agentId,seq,post.text,post.hashtags_json,post.media_json,source,now,new Date(Date.now()-45*60000).toISOString(),now,
      agentId,source,day,source==='manual'?40:Math.min(5,Math.max(1,agent.autoPublishCap)),now).first<{id:number}>();
  if(!claim)throw new HttpError(409,'This post is already being sent, needs review, or has reached its daily send allowance.');
  // From this point any exception is ambiguous. The permanent claim prevents an automatic resend.
  let result:Awaited<ReturnType<typeof createPost>>;
  try {
    await env.DB.prepare('UPDATE posts SET linkedin_text=? WHERE agent_id=? AND seq=?').bind(text,agentId,seq).run();
    result=await createPost({token:credentials.token,authorUrn:credentials.memberUrn,text,images});
  }catch {result={ok:false,reason:'send_outcome_unknown'};}
  const sentAt=new Date().toISOString();
  if(result.ok) {
    await env.DB.batch([
      env.DB.prepare("UPDATE distributions SET status='sent',external_urn=?,settled_at=? WHERE id=?").bind(result.data.postUrn,sentAt,claim.id),
      env.DB.prepare("UPDATE posts SET status='published',published_at=?,hold_until=NULL WHERE agent_id=? AND seq=?").bind(sentAt,agentId,seq),
      env.DB.prepare('UPDATE linkedin_accounts SET last_ok_at=?,last_error=NULL WHERE agent_id=?').bind(sentAt,agentId),
      env.DB.prepare("UPDATE slot_runs SET outcome='published' WHERE post_seq=? AND slot_id IN (SELECT id FROM post_slots WHERE agent_id=?)").bind(seq,agentId),
    ]);
    return {ok:true,postUrn:result.data.postUrn,permalink:postPermalink(result.data.postUrn)};
  }
  const definite=!!result.status&&result.status>=400&&result.status<500;
  const reason=definite?`LinkedIn rejected the request (HTTP ${result.status}).`:'The send outcome is unknown. Check LinkedIn before trying again.';
  await env.DB.batch([
    env.DB.prepare('UPDATE distributions SET status=?,last_error=?,settled_at=? WHERE id=?').bind(definite?'failed':'unknown',reason,sentAt,claim.id),
    env.DB.prepare('UPDATE posts SET status=?,cleared_at=NULL WHERE agent_id=? AND seq=?').bind(definite?'failed':'unknown',agentId,seq),
    env.DB.prepare('UPDATE linkedin_accounts SET last_error=? WHERE agent_id=?').bind(reason,agentId),
  ]);
  return {ok:false,error:reason,ambiguous:!definite,needsReauth:result.status===401};
}
export async function resolveSend(db:D1Database,agentId:string,seq:number,didPublish:boolean) {
  const nonce=crypto.randomUUID();
  const changed=await db.batch([
    db.prepare(`UPDATE distributions SET status=?,settled_at=?,last_error=NULL,resolution_token=? WHERE agent_id=? AND seq=? AND
      (status='unknown' OR (status='in_flight' AND created_at<?)) RETURNING id`)
      .bind(didPublish?'sent':'failed',new Date().toISOString(),nonce,agentId,seq,new Date(Date.now()-10*60000).toISOString()),
    db.prepare(`UPDATE posts SET status=?,published_at=?,cleared_at=NULL WHERE agent_id=? AND seq=? AND status!='published'
      AND EXISTS(SELECT 1 FROM distributions WHERE agent_id=? AND seq=? AND resolution_token=?)`)
      .bind(didPublish?'published':'draft',didPublish?new Date().toISOString():null,agentId,seq,agentId,seq,nonce),
  ]);
  if(!changed[0].meta.changes)throw new HttpError(409,'There is no unresolved send to confirm yet.');
  return {ok:true};
}
