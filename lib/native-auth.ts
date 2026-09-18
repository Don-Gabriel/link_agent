import { createHash, randomUUID } from 'node:crypto';
import { createUserSession } from './auth';
import { query, getPool, ensureSchema } from './db';
import { exchangeCode, getMemberIdentity } from './linkedin';
import { saveAccount } from './accounts';

export const localTestMode = () => process.env.BYLINE_TEST_MODE === 'true' && process.env.BYLINE_LOCAL_ONLY === 'true';
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');

export async function provisionUser(provider: string, subject: string, name: string, inviteHash?: string | null) {
  await ensureSchema();
  const c = await getPool()!.connect();
  try {
    await c.query('BEGIN');
    // Serialize the same identity so concurrent first sign-ins consume one invitation.
    await c.query('SELECT pg_advisory_xact_lock(71,hashtext($1))',[`${provider}:${subject}`]);
    const existing=await c.query('SELECT id FROM byline_users WHERE provider=$1 AND subject=$2',[provider,subject]);
    if(!existing.rowCount && process.env.BYLINE_REGISTRATION_MODE==='invite' && !localTestMode()) {
      const invited=await c.query(`UPDATE byline_invites SET remaining_uses=remaining_uses-1
        WHERE code_hash=$1 AND remaining_uses>0 AND expires_at>now() RETURNING code_hash`,[inviteHash??'']);
      if(!invited.rowCount)throw new Error('A valid invitation is required for a new account. Ask your ByLine operator for a code.');
    }
    const { rows: [user] } = await c.query<{ id: string }>(
      `INSERT INTO byline_users(provider,subject,name) VALUES($1,$2,$3)
       ON CONFLICT(provider,subject) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [provider,subject,name.slice(0,100)]);
    const persona = {input:{name,domain:'Your selected topics'}, identity:{voice:'Clear and thoughtful. Do not invent personal experiences or opinions.',interests:[],opinions:[],skeptical_of:[]},generator:'fallback'};
    await c.query(`INSERT INTO agents(name,domain,persona_json,persona_hash,owner_id,paused,timezone,post_time_local,style_json,categories_json)
      VALUES($1,'Your selected topics',$2,$3,$4,true,'UTC','09:00',$5,'["emerging-tech"]')
      ON CONFLICT(owner_id) WHERE owner_id IS NOT NULL DO NOTHING`,
      [name,JSON.stringify(persona),digest(`byline:${user.id}`),user.id,JSON.stringify({signature:null})]);
    await c.query('INSERT INTO onboarding(user_id) VALUES($1) ON CONFLICT DO NOTHING',[user.id]);
    await c.query('COMMIT');
    return user.id;
  } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

export async function issueSession(userId: string) {
  const id = randomUUID();
  const session = await createUserSession(userId,id);
  await query('INSERT INTO byline_sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval \'30 days\')',[id,userId]);
  return session.value;
}

export async function completeNativeAuth(state: string, code: string | null, denied: boolean) {
  const [flow] = await query<{provider:string;redirect_uri:string;return_uri:string|null;invite_hash:string|null}>(
    `UPDATE native_auth SET claimed_at=now() WHERE id=$1 AND claimed_at IS NULL
     AND created_at>now()-interval '10 minutes' RETURNING provider,redirect_uri,return_uri,invite_hash`,[state]);
  if (!flow) return null;
  let ok = true;
  try {
    if (denied || !code) throw new Error('Sign-in was cancelled. Please try again.');
    let userId: string;
    if (flow.provider === 'linkedin') {
      const grant = await exchangeCode(code,flow.redirect_uri);
      if (!grant.ok) throw new Error('LinkedIn sign-in could not be completed. Please try again.');
      const identity = await getMemberIdentity(grant.data.accessToken);
      if (!identity.ok) throw new Error('Could not verify your LinkedIn identity.');
      userId = await provisionUser('linkedin',identity.data.personUrn,identity.data.name ?? 'ByLine author',flow.invite_hash);
      const [agent] = await query<{id:string}>('SELECT id FROM agents WHERE owner_id=$1',[userId]);
      await saveAccount(agent.id,grant.data,identity.data);
    } else if (flow.provider === 'google') {
      const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(15000),
        body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,redirect_uri:flow.redirect_uri,grant_type:'authorization_code'})});
      if (!r.ok) throw new Error('Google sign-in could not be completed. Please try again.');
      const token = await r.json();
      const u = await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)});
      if (!u.ok) throw new Error('Could not verify your Google identity.');
      const identity = await u.json();
      if (typeof identity.sub !== 'string') throw new Error('Could not verify your Google identity.');
      userId = await provisionUser('google',identity.sub,identity.name ?? 'ByLine author',flow.invite_hash);
    } else throw new Error('Unsupported sign-in provider.');
    await query('UPDATE native_auth SET user_id=$2 WHERE id=$1',[state,userId]);
  } catch(e) {
    ok = false;
    await query('UPDATE native_auth SET error=$2 WHERE id=$1',[state,(e as Error).message.slice(0,200)]);
  }
  return {ok, returnUri:flow.return_uri};
}
