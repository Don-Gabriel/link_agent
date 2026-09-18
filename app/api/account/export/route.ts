import {NextResponse} from 'next/server';
import {requestIdentity} from '../../../../lib/request-agent';
import {query} from '../../../../lib/db';
export const dynamic='force-dynamic';
export async function GET() {
  const user=await requestIdentity();
  if(!user)return NextResponse.json({error:'unauthorized'},{status:401});
  const [account,agents,posts,slots,onboarding,ai]=await Promise.all([
    query('SELECT name,provider,created_at FROM byline_users WHERE id=$1',[user.userId]),
    query('SELECT name,domain,persona_json,categories_json,style_json,corpus_json,edit_notes,timezone,post_time_local,paused,auto_publish FROM agents WHERE owner_id=$1',[user.userId]),
    query('SELECT p.* FROM posts p JOIN agents a ON a.id=p.agent_id WHERE a.owner_id=$1 ORDER BY p.created_at',[user.userId]),
    query('SELECT s.* FROM post_slots s JOIN agents a ON a.id=s.agent_id WHERE a.owner_id=$1',[user.userId]),
    query('SELECT config,completed_at FROM onboarding WHERE user_id=$1',[user.userId]),
    query('SELECT model,data_policy,validated_at FROM byline_ai_credentials WHERE user_id=$1',[user.userId]),
  ]);
  // Deliberately omit sessions, credentials, invite codes and device tokens.
  return NextResponse.json({exportedAt:new Date().toISOString(),account:account[0],agents,posts,slots,onboarding:onboarding[0],ai:ai[0]??null},
    {headers:{'Cache-Control':'no-store','Content-Disposition':'attachment; filename="byline-account.json"'}});
}
