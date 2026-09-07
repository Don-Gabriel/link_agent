import { NextResponse } from 'next/server';
import { requestIdentity } from '../../../../lib/request-agent';
import { getPool } from '../../../../lib/db';
export const dynamic='force-dynamic';

/** User-scoped removal. No provider calls and no deletion of LinkedIn posts. */
export async function POST(request:Request) {
  const user=await requestIdentity();
  if(!user)return NextResponse.json({error:'Sign in to delete your ByLine account.'},{status:401});
  const body=await request.json().catch(()=>null);
  if(body?.confirmation!=='DELETE')return NextResponse.json({error:'Type DELETE to confirm account deletion.'},{status:400});
  const c=await getPool()!.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout='5s'");
    // Parent row locks also serialize new child inserts and publish claims.
    await c.query('SELECT id FROM byline_users WHERE id=$1 FOR UPDATE',[user.userId]);
    const agents=await c.query('SELECT id FROM agents WHERE owner_id=$1 FOR UPDATE',[user.userId]);
    const ids=agents.rows.map(a=>a.id);
    for(const id of ids) {
      const lock=await c.query('SELECT pg_try_advisory_xact_lock(42,hashtext($1)) AS locked',[id]);
      if(!lock.rows[0].locked)throw new Error('busy');
      const slots=await c.query('SELECT id FROM post_slots WHERE agent_id=$1',[id]);
      for(const slot of slots.rows) {
        const lock=await c.query('SELECT pg_try_advisory_xact_lock(43,hashtext($1)) AS locked',[slot.id]);
        if(!lock.rows[0].locked)throw new Error('busy');
      }
    }
    const sending=await c.query("SELECT 1 FROM distributions WHERE agent_id=ANY($1::uuid[]) AND status='in_flight' LIMIT 1",[ids]);
    if(sending.rowCount)throw new Error('publishing');
    // Fixed, reviewed identifiers: never accept table names from the request.
    for(const table of ['notification_outbox','review_deliveries','device_tokens','push_log','oauth_states',
      'linkedin_accounts','distributions','media_assets','rejections','scheduler_state','post_counters','posts','post_slots']) {
      await c.query(`DELETE FROM ${table} WHERE agent_id=ANY($1::uuid[])`,[ids]);
    }
    await c.query('DELETE FROM ai_usage WHERE owner=$1 OR owner=ANY($2::text[])',[user.userId,ids]);
    await c.query('DELETE FROM ai_user_days WHERE owner=$1 OR owner=ANY($2::text[])',[user.userId,ids]);
    for(const table of ['byline_sessions','native_auth','onboarding'])await c.query(`DELETE FROM ${table} WHERE user_id=$1`,[user.userId]);
    await c.query('DELETE FROM agents WHERE owner_id=$1',[user.userId]);
    await c.query('DELETE FROM byline_users WHERE id=$1',[user.userId]);
    await c.query('COMMIT');
    return NextResponse.json({ok:true,deleted:true});
  } catch(e) {
    await c.query('ROLLBACK');
    const reason=(e as Error).message;
    return NextResponse.json({error:reason==='publishing'
      ? 'A publish request is still unresolved. Check its outcome in My posts before deleting your account.'
      : 'Your account could not be deleted yet. Wait for any active preparation or upload to finish, then try again. No data was removed.'},{status:409});
  } finally {c.release();}
}
