import { body,HttpError,json } from './http';
import type { Owner } from './auth';
export async function deleteAccount(request:Request,db:D1Database,owner:Owner) {
  if((await body(request)).confirmation!=='DELETE')throw new HttpError(400,'Type DELETE to confirm account deletion.');
  const clear="NOT EXISTS(SELECT 1 FROM distributions WHERE agent_id=? AND status='in_flight')";
  const statements:D1PreparedStatement[]=[];
  for(const table of ['generation_jobs','notification_outbox','review_deliveries','device_tokens','push_log','oauth_states','linkedin_accounts','media_assets','rejections','scheduler_state','post_counters','posts','post_slots'])
    statements.push(db.prepare(`DELETE FROM ${table} WHERE agent_id=? AND ${clear}`).bind(owner.agentId,owner.agentId));
  for(const table of ['ai_usage','ai_user_days','ai_reservations'])statements.push(db.prepare(`DELETE FROM ${table} WHERE owner IN (?,?) AND ${clear}`).bind(owner.userId,owner.agentId,owner.agentId));
  for(const table of ['byline_sessions','native_auth','onboarding'])statements.push(db.prepare(`DELETE FROM ${table} WHERE user_id=? AND ${clear}`).bind(owner.userId,owner.agentId));
  statements.push(db.prepare(`DELETE FROM distributions WHERE agent_id=? AND ${clear}`).bind(owner.agentId,owner.agentId));
  statements.push(db.prepare(`DELETE FROM agents WHERE id=? AND owner_id=? AND ${clear}`).bind(owner.agentId,owner.userId,owner.agentId));
  statements.push(db.prepare(`DELETE FROM byline_users WHERE id=? AND ${clear} RETURNING id`).bind(owner.userId,owner.agentId));
  const result=await db.batch(statements);
  if(!result.at(-1)!.meta.changes)throw new HttpError(409,'A publish request is unresolved. Check its outcome before deleting your account. No data was removed.');
  return json({ok:true,deleted:true});
}
