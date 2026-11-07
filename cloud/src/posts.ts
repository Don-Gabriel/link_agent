import { assemblePost,checkLength,MAX_BODY_CHARS,hookOf } from '../../lib/format';
import { rewriteDraft,writeFollowUp,polishCustomPost } from '../../lib/writer-core';
import { parseStyle } from '../../lib/style';
import { pickSamples } from '../../lib/voice-prompt';
import { critique } from '../../lib/critique';
import { isCategoryId } from '../../lib/categories';
import { body,json,text,HttpError } from './http';
import { loadAgent,postView,type CloudPost } from './models';
import { saveDraft } from './drafts';
import { ownedImages,publish,resolveSend,type Reviewed } from './publish';
import { completion } from './ai';
import type { AppEnv } from './env';
import type { Owner } from './auth';
export function tags(value:unknown) {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>15||value.some(t=>typeof t!=='string'||!/^#?[A-Za-z0-9]{3,40}$/.test(t)))throw new HttpError(400,'Use up to 15 alphanumeric hashtags.');
  return [...new Set(value.map(t=>t.replace(/^#/,'')))];
}
function reviewed(value:unknown):Reviewed|undefined {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||!('text'in value)||typeof value.text!=='string'||!('hashtags'in value)||!Array.isArray(value.hashtags)||!('media'in value)||!Array.isArray(value.media))throw new HttpError(400,'Invalid review.');
  return {text:value.text,hashtags:tags(value.hashtags),media:value.media};
}
function future(value:unknown):string|null {
  if(value==null)return null;
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||Date.parse(value)<=Date.now())throw new HttpError(400,'Choose a send time in the future.');
  return new Date(value).toISOString();
}
export async function voiceContext(db:D1Database,id:string) {
  const {settings:agent,persona}=await loadAgent(db,id);
  const published=(await db.prepare("SELECT text FROM posts WHERE agent_id=? AND status='published' ORDER BY seq DESC LIMIT 3").bind(id).all<{text:string}>()).results;
  return {agent,persona,voice:{samples:pickSamples(agent.corpus,published.map(p=>p.text)),editNotes:agent.editNotes}};
}
export async function postsRoute(request:Request,env:AppEnv,owner:Owner) {
  if(request.method==='GET') {
    const cursor=new URL(request.url).searchParams.get('before'),before=cursor===null?null:Number(cursor);
    if(before!==null&&(!Number.isInteger(before)||before<1))throw new HttpError(400,'Invalid archive cursor.');
    const rows=(await env.DB.prepare(`SELECT * FROM posts WHERE agent_id=? AND status='published' AND (? IS NULL OR
      (published_at,seq)<(SELECT published_at,seq FROM posts WHERE agent_id=? AND seq=?)) ORDER BY published_at DESC,seq DESC LIMIT 21`)
      .bind(owner.agentId,before,owner.agentId,before).all<CloudPost>()).results;
    return json({posts:rows.slice(0,20).map(postView),hasMore:rows.length>20});
  }
  const b=await body(request);
  let value=text(b.text,MAX_BODY_CHARS);
  if(value.length<20)throw new HttpError(400,'Write at least 20 characters.');
  const requestId=b.clientRequestId===undefined?crypto.randomUUID():text(b.clientRequestId,100);
  if(!/^[A-Za-z0-9_-]{20,100}$/.test(requestId))throw new HttpError(400,'Invalid request identifier.');
  if(b.polish&&b.publishNow)throw new HttpError(409,'Review the polished draft before publishing.');
  let hashtags=tags(b.hashtags),polishedBy:string|undefined;
  if(b.polish) {
    const c=await voiceContext(env.DB,owner.agentId),r=await polishCustomPost(completion(env,owner.userId),c.persona,value,c.agent.style,c.voice);
    if(r.ok&&!critique(r.data.text,c.agent.style,{hashtags:r.data.hashtags}).length){value=r.data.text;polishedBy=r.data.servedBy;if(!hashtags.length)hashtags=r.data.hashtags;}
  }
  const media=b.mediaIds??[];await ownedImages(env.DB,owner.agentId,media);
  if(!checkLength(assemblePost({body:value,hashtags,maxHashtags:15})).withinLimit)throw new HttpError(400,'The post exceeds LinkedIn’s text limit.');
  const at=b.publishNow?null:future(b.scheduledFor);
  const seq=await saveDraft(env.DB,{agentId:owner.agentId,requestId,text:value,rationale:polishedBy?'Written by you and polished with AI.':'Written by you.',fingerprint:value.slice(0,100),sources:[],hashtags,media:media as string[],scheduledFor:at,cleared:!!at,category:isCategoryId(b.category)?b.category:undefined});
  const saved=await env.DB.prepare('SELECT text,hashtags_json,media_json FROM posts WHERE agent_id=? AND seq=?').bind(owner.agentId,seq).first<{text:string;hashtags_json:string;media_json:string}>();
  if(saved!.text!==value||saved!.hashtags_json!==JSON.stringify(hashtags)||saved!.media_json!==JSON.stringify(media))return json({error:'Your earlier save succeeded. Review the saved draft before changing it.',seq},409);
  if(b.publishNow){const r=await publish(env,owner.agentId,seq);return json({...r,id:`p${seq}`,seq},r.ok?200:502);}
  return json({ok:true,id:`p${seq}`,seq,status:'draft',scheduledFor:at,polishedBy});
}
export async function postAction(request:Request,env:AppEnv,owner:Owner,seq:number) {
  const b=await body(request),post=await env.DB.prepare('SELECT * FROM posts WHERE agent_id=? AND seq=?').bind(owner.agentId,seq).first<CloudPost>();
  if(!post)throw new HttpError(404,'Post not found.');
  if(b.action==='publish'){const r=await publish(env,owner.agentId,seq,'manual',reviewed(b.reviewed));return json(r,r.ok?200:502);}
  if(b.action==='resolve') {
    if(typeof b.didPublish!=='boolean')throw new HttpError(400,'Confirm whether the post appeared on LinkedIn.');
    return json(await resolveSend(env.DB,owner.agentId,seq,b.didPublish));
  }
  if(b.action==='rewrite'||b.action==='followup') {
    if((b.action==='rewrite'&&post.status==='published')||(b.action==='followup'&&post.status!=='published'))throw new HttpError(409,'This action does not apply to the current post.');
    if(post.status==='unknown'||await env.DB.prepare("SELECT id FROM distributions WHERE agent_id=? AND seq=? AND status IN ('in_flight','unknown')").bind(owner.agentId,seq).first())throw new HttpError(409,'Resolve the pending send before changing this post.');
    const c=await voiceContext(env.DB,owner.agentId),complete=completion(env,owner.userId);
    const r=b.action==='rewrite'?await rewriteDraft(complete,c.persona,post.text,c.agent.style,Number.isInteger(b.variant)?Math.abs(Number(b.variant))%4:0,c.voice)
      :await writeFollowUp(complete,c.persona,{text:post.text,publishedAt:post.published_at},c.agent.style,c.voice);
    if(!r.ok)throw new HttpError(503,'The writer is unavailable. Your original post is saved.');
    return json({ok:true,...r.data});
  }
  let set:string,args:unknown[]=[];
  if(b.action==='edit') {
    const value=text(b.text,MAX_BODY_CHARS),hashtags=tags(b.hashtags),media=b.mediaIds??JSON.parse(post.media_json??'[]');
    if(value.length<20)throw new HttpError(400,'Write at least 20 characters.');
    await ownedImages(env.DB,owner.agentId,media);
    if(!checkLength(assemblePost({body:value,hashtags,maxHashtags:15,sourceUrl:(media as string[]).length?undefined:JSON.parse(post.sources_json??'[]')[0]})).withinLimit)throw new HttpError(400,'The post exceeds LinkedIn’s text limit.');
    set="original_text=COALESCE(original_text,text),text=?,hashtags_json=?,media_json=?,status='draft',cleared_at=NULL";args=[value,JSON.stringify(hashtags),JSON.stringify(media)];
  }else if(b.action==='clear') {
    if(!post.scheduled_for)throw new HttpError(409,'Choose a send time or publish manually.');
    const r=reviewed(b.reviewed);
    if(r&&(r.text!==post.text||JSON.stringify(r.hashtags)!==post.hashtags_json||JSON.stringify(r.media)!==post.media_json))throw new HttpError(409,'The post changed. Refresh and review it again.');
    set="cleared_at=?,hold_until=NULL,status='approved'";args=[new Date().toISOString()];
  }else if(b.action==='unclear')set="cleared_at=NULL,status='draft'";
  else if(b.action==='hold'){set='hold_until=?';args=[new Date(Date.now()+15*60000).toISOString()];}
  else if(b.action==='release')set='hold_until=NULL';
  else if(b.action==='reschedule'){set="scheduled_for=?,cleared_at=NULL,status='draft'";args=[future(b.scheduledFor)];}
  else if(b.action==='discard')set="status='rejected',cleared_at=NULL,scheduled_for=NULL";
  else throw new HttpError(400,'Unknown post action.');
  // The condition and mutation are one statement: a publish cannot start between a check and an edit.
  const updated=await env.DB.prepare(`UPDATE posts SET ${set} WHERE agent_id=? AND seq=? AND status IN ('draft','approved','failed','missed')
    AND text=? AND hashtags_json=? AND media_json=? AND NOT EXISTS(SELECT 1 FROM distributions d WHERE d.agent_id=posts.agent_id AND d.seq=posts.seq AND d.status IN ('in_flight','sent','unknown')) RETURNING seq`)
    .bind(...args,owner.agentId,seq,post.text,post.hashtags_json,post.media_json).first();
  if(!updated)throw new HttpError(409,'This post changed or a send has started. Refresh to see its latest state.');
  return json({ok:true,scheduledFor:b.action==='reschedule'?args[0]:post.scheduled_for,holdMinutes:15});
}
export async function rewriteRoute(request:Request,env:AppEnv,owner:Owner,preview=false) {
  const b=await body(request),c=await voiceContext(env.DB,owner.agentId);
  let value=typeof b.text==='string'?text(b.text,MAX_BODY_CHARS):'';
  let sourceLabel='your draft';
  if(preview&&!value) {
    const last=await env.DB.prepare('SELECT text FROM posts WHERE agent_id=? ORDER BY seq DESC LIMIT 1').bind(owner.agentId).first<{text:string}>();
    const setup=await env.DB.prepare('SELECT json_extract(preview,\'$.text\') AS text FROM onboarding WHERE user_id=? AND accepted_revision=preview_revision').bind(owner.userId).first<{text:string|null}>();
    value=last?.text??setup?.text??c.voice.samples[0]?.text??'';sourceLabel=last?'your latest post':setup?.text?'your reviewed setup sample':'your writing sample';
  }
  if(value.length<20)throw new HttpError(400,'Add a draft or writing sample first.');
  const style=preview?parseStyle({...c.agent.style,...(b.style&&typeof b.style==='object'?b.style:{})}):c.agent.style;
  const complete=completion(env,owner.userId),r=preview?await polishCustomPost(complete,c.persona,value,style,c.voice):await rewriteDraft(complete,c.persona,value,style,Number.isInteger(b.variant)?Math.abs(Number(b.variant))%4:0,c.voice);
  if(!r.ok)throw new HttpError(503,'The writer is temporarily unavailable. Your original text is saved.');
  const after=assemblePost({body:r.data.text,hashtags:r.data.hashtags,maxHashtags:style.hashtagCount});
  if(preview)return json({ok:true,sourceLabel,before:value,after,hook:hookOf(after),length:checkLength(after),style,servedBy:r.data.servedBy});
  return json({ok:true,...r.data});
}
