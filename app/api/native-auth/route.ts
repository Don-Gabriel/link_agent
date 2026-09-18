import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { digest, issueSession, localTestMode, provisionUser } from '../../../lib/native-auth';
import { query } from '../../../lib/db';
import { authorizeUrl } from '../../../lib/linkedin';
import { nativeReturnUri } from '../../../lib/native-return';
import { checkLoginAllowed, recordLoginFailure, clientKey } from '../../../lib/ratelimit';
export const dynamic = 'force-dynamic';
const json = (v:unknown,status=200) => NextResponse.json(v,{status,headers:{'Cache-Control':'no-store'}});
export async function GET() {
  return json({google:!!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),
    linkedin:!!(process.env.LINKEDIN_CLIENT_ID&&process.env.LINKEDIN_CLIENT_SECRET),localTest:localTestMode(),
    invitationRequired:process.env.BYLINE_REGISTRATION_MODE==='invite',legacyLogin:process.env.BYLINE_ALLOW_LEGACY_AUTH!=='false'});
}
export async function POST(request:Request) {
  const body = await request.json().catch(()=>null);
  if (!body || typeof body.verifier!=='string' || !/^[A-Za-z0-9_-]{43,128}$/.test(body.verifier)) return json({error:'invalid_request'},400);
  if (body.action==='poll') {
    const [flow] = await query<{user_id:string|null;error:string|null}>(
      `DELETE FROM native_auth WHERE id=$1 AND verifier_hash=$2 AND created_at>now()-interval '10 minutes'
       AND (user_id IS NOT NULL OR error IS NOT NULL) RETURNING user_id,error`,[body.id,digest(body.verifier)]);
    if (!flow) return json({pending:true});
    if (flow.error) return json({error:'sign_in_failed',detail:flow.error},400);
    return json({token:await issueSession(flow.user_id!)});
  }
  const key = clientKey(request);
  if (!(await checkLoginAllowed(key)).allowed) return json({error:'Please wait before trying again.'},429);
  await recordLoginFailure(key); // bound account/flow creation too, across instances
  if (body.provider==='local' && localTestMode()) {
    const id = await provisionUser('local',randomUUID(),'Sample author');
    return json({token:await issueSession(id),testMode:true});
  }
  const provider = body.provider;
  if(body.inviteCode!=null && (typeof body.inviteCode!=='string'||body.inviteCode.length>128))return json({error:'invalid_invitation'},400);
  const inviteHash=body.inviteCode?.trim() ? digest(body.inviteCode.trim()) : null;
  const returnUri = nativeReturnUri(body.returnUri);
  if (body.returnUri != null && !returnUri) return json({error:'invalid_return_uri'},400);
  const origin = process.env.BYLINE_PUBLIC_URL ?? new URL(request.url).origin;
  const redirect = provider==='linkedin' ? process.env.LINKEDIN_REDIRECT_URI ?? `${origin}/api/linkedin/callback` : process.env.GOOGLE_REDIRECT_URI ?? `${origin}/api/native-auth/callback`;
  const id = `native-${randomUUID()}`;
  let url:string|null=null;
  if (provider==='linkedin') url=authorizeUrl(id,redirect);
  if (provider==='google' && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    url=`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:'openid profile email',state:id,prompt:'select_account'})}`;
  }
  if (!url) return json({error:'This sign-in option is not configured yet.'},503);
  await query(`DELETE FROM native_auth WHERE created_at<now()-interval '1 hour'`);
  await query('INSERT INTO native_auth(id,provider,verifier_hash,redirect_uri,return_uri,invite_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,provider,digest(body.verifier),redirect,returnUri,inviteHash]);
  return json({id,url});
}
