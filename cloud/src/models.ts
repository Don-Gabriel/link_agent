import { parseCategories } from '../../lib/categories';
import { parseStyle } from '../../lib/style';
import { parseCorpus } from '../../lib/voice-prompt';
import type { PersonaRecord } from '../../lib/persona-prompt';
import { serializePost, type PostRow } from '../../lib/post-view';
import { HttpError } from './http';

export interface AgentRow {
  id:string;owner_id:string;name:string;domain:string;timezone:string;post_time_local:string;
  categories_json:string;style_json:string;corpus_json:string;persona_json:string;edit_notes:string|null;
  auto_publish:number;auto_publish_cap:number;paused:number;active:number;revision:number;
}
export function agentView(r:AgentRow) {
  return {agentId:r.id,name:r.name,domain:r.domain,categories:parseCategories(JSON.parse(r.categories_json)),timezone:r.timezone,
    postTimeLocal:r.post_time_local,autoPublish:!!r.auto_publish,paused:!!r.paused,active:!!r.active,autoPublishCap:r.auto_publish_cap,
    style:parseStyle(JSON.parse(r.style_json)),corpus:parseCorpus(JSON.parse(r.corpus_json)),editNotes:r.edit_notes};
}
export async function loadAgent(db:D1Database,id:string) {
  const row=await db.prepare('SELECT * FROM agents WHERE id=?').bind(id).first<AgentRow>();
  if(!row)throw new HttpError(404,'Account not found.');
  return {row,settings:agentView(row),persona:JSON.parse(row.persona_json) as PersonaRecord};
}
type JsonPostKeys='scores_json'|'sources_json'|'media_json'|'hashtags_json';
type DatePostKeys='created_at'|'published_at'|'scheduled_for'|'cleared_at'|'hold_until';
export type CloudPost=Omit<PostRow,JsonPostKeys|DatePostKeys|'used_quote'> & {
  [K in JsonPostKeys]:string|null;
} & {[K in DatePostKeys]:string|null} & {used_quote:number;review_notes_json?:string};
export function postView(r:CloudPost) {
  return {...serializePost({...r,scores_json:r.scores_json?JSON.parse(r.scores_json):null,
    sources_json:JSON.parse(r.sources_json??'[]'),media_json:JSON.parse(r.media_json??'[]'),hashtags_json:JSON.parse(r.hashtags_json??'[]'),
    used_quote:!!r.used_quote,created_at:new Date(r.created_at!),published_at:r.published_at?new Date(r.published_at):null,
    scheduled_for:r.scheduled_for?new Date(r.scheduled_for):null,cleared_at:r.cleared_at?new Date(r.cleared_at):null,hold_until:r.hold_until?new Date(r.hold_until):null}),reviewNotes:JSON.parse(r.review_notes_json??'[]') as string[]};
}
export async function accountStatus(db:D1Database,agentId:string) {
  const row=await db.prepare(`SELECT member_urn,member_name,member_picture,expires_at,last_ok_at,last_error,refresh_token_enc IS NOT NULL AS refresh FROM linkedin_accounts WHERE agent_id=?`)
    .bind(agentId).first<{member_urn:string;member_name:string|null;member_picture:string|null;expires_at:string;last_ok_at:string|null;last_error:string|null;refresh:number}>();
  if(!row)return {connected:false};
  const remaining=Date.parse(row.expires_at)-Date.now();
  return {connected:true,memberUrn:row.member_urn,memberName:row.member_name,memberPicture:row.member_picture,expiresAt:row.expires_at,
    daysRemaining:Math.max(0,Math.floor(remaining/86400000)),expiringSoon:remaining>0&&remaining<7*86400000,needsReauth:remaining<=0,
    hasRefreshToken:!!row.refresh,lastOkAt:row.last_ok_at,lastError:row.last_error};
}
