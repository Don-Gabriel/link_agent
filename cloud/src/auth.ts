import { nativeReturnUri } from '../../lib/native-return';
import { nativeCallbackPage } from '../../lib/native-callback';
import { SCOPES } from '../../lib/linkedin';
import { provisionIdentity, sessionOwner } from './identities';
import { digest, signSession, verifySession, encryptToken } from './crypto';
import { body, json, HttpError, responseJson } from './http';
import type { AppEnv } from './env';
type AuthEnv=Omit<AppEnv,'CONTENT'|'MAINTENANCE'>;

export type Owner={userId:string;agentId:string;name:string;sessionId:string};
const ago=(ms:number)=>new Date(Date.now()-ms).toISOString();
const now=()=>new Date().toISOString();
const flowLife=10*60*1000;
export async function authenticate(request:Request,env:AuthEnv):Promise<Owner|null> {
  const bearer=/^Bearer (\S+)$/.exec(request.headers.get('Authorization')??'');
  // This API is for the native client. Cookie authentication is not accepted.
  if(!bearer)return null;
  const id=await verifySession(env.APP_SECRET,bearer[1]);
  if(!id)return null;
  const owner=await sessionOwner(env.DB,id.userId,id.sessionId);
  return owner?{...owner,sessionId:id.sessionId}:null;
}
export async function limitLogin(request:Request,env:AuthEnv) {
  const client=await digest(env.APP_SECRET+':'+(request.headers.get('CF-Connecting-IP')??'local'));
  const result=await env.DB.prepare(`INSERT INTO login_attempts(client)
    SELECT ? WHERE (SELECT count(*) FROM login_attempts WHERE client=? AND at>?)<10 RETURNING id`)
    .bind(client,client,ago(15*60*1000)).first();
  if(!result)throw new HttpError(429,'Please wait before trying to sign in again.');
}
export function capabilities(env:AuthEnv) {
  return {linkedin:!!(env.LINKEDIN_CLIENT_ID&&env.LINKEDIN_CLIENT_SECRET),google:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),localTest:false};
}
export function authorizationUrl(env:AuthEnv,provider:string,state:string,redirect:string) {
  const linkedin=provider==='linkedin';
  return `${linkedin?'https://www.linkedin.com/oauth/v2/authorization':'https://accounts.google.com/o/oauth2/v2/auth'}?${new URLSearchParams({
    client_id:linkedin?env.LINKEDIN_CLIENT_ID:env.GOOGLE_CLIENT_ID!,redirect_uri:redirect,response_type:'code',state,
    scope:linkedin?SCOPES.join(' '):'openid profile email',
  })}`;
}
export async function nativeAuth(request:Request,env:AuthEnv) {
  if(request.method==='GET')return json(capabilities(env));
  const b=await body(request);
  if(typeof b.verifier!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(b.verifier))throw new HttpError(400,'invalid_request');
  const hash=await digest(b.verifier);
  if(b.action==='poll') {
    if(typeof b.id!=='string'||!/^native-[a-f0-9-]{36}$/.test(b.id))throw new HttpError(400,'invalid_request');
    const sessionId=crypto.randomUUID();
    const expires=Date.now()+30*86400000;
    // Consume the flow and create its session in one transaction. Concurrent polls cannot issue two sessions.
    const result=await env.DB.batch([
      env.DB.prepare(`INSERT INTO byline_sessions(id,user_id,expires_at)
        SELECT ?,user_id,? FROM native_auth WHERE id=? AND verifier_hash=? AND created_at>? AND user_id IS NOT NULL AND error IS NULL RETURNING user_id`)
        .bind(sessionId,new Date(expires).toISOString(),b.id,hash,ago(flowLife)),
      env.DB.prepare(`DELETE FROM native_auth WHERE id=? AND verifier_hash=? AND created_at>? AND (user_id IS NOT NULL OR error IS NOT NULL) RETURNING error`)
        .bind(b.id,hash,ago(flowLife)),
    ]);
    const user=result[0].results[0] as {user_id:string}|undefined;
    if(user)return json({token:await signSession(env.APP_SECRET,user.user_id,sessionId,expires)});
    if(result[1].results.length)return json({error:'sign_in_failed',detail:'Sign-in could not be completed. Please try again.'},400);
    return json({pending:true});
  }
  if(b.action!==undefined&&b.action!=='start')throw new HttpError(400,'Unknown sign-in action.');
  await limitLogin(request,env);
  const provider=b.provider;
  if((provider!=='google'&&provider!=='linkedin')||!capabilities(env)[provider])throw new HttpError(503,'This sign-in option is not configured.');
  const returnUri=nativeReturnUri(b.returnUri);
  if(b.returnUri!=null&&!returnUri)throw new HttpError(400,'invalid_return_uri');
  const id=`native-${crypto.randomUUID()}`;
  const redirect=new URL(provider==='linkedin'?'/api/linkedin/callback':'/api/native-auth/callback',request.url).href;
  await env.DB.prepare('INSERT INTO native_auth(id,provider,verifier_hash,redirect_uri,return_uri) VALUES(?,?,?,?,?)').bind(id,provider,hash,redirect,returnUri).run();
  return json({id,url:authorizationUrl(env,provider,id,redirect)});
}
type Grant={access_token:string;expires_in:number;refresh_token?:string;scope?:string};
type Identity={sub:string;name?:string;picture?:string};
async function exchange(env:AuthEnv,provider:string,code:string,redirect:string) {
  const linkedin=provider==='linkedin';
  const grant=await responseJson<Grant>(await fetch(linkedin?'https://www.linkedin.com/oauth/v2/accessToken':'https://oauth2.googleapis.com/token',{
    method:'POST',signal:AbortSignal.timeout(15000),body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirect,
      client_id:linkedin?env.LINKEDIN_CLIENT_ID:env.GOOGLE_CLIENT_ID!,client_secret:linkedin?env.LINKEDIN_CLIENT_SECRET:env.GOOGLE_CLIENT_SECRET!}),
  }));
  if(typeof grant.access_token!=='string'||!grant.access_token||grant.access_token.length>16384||!Number.isFinite(grant.expires_in)||grant.expires_in<=0)throw new Error('Invalid provider grant');
  const identity=await responseJson<Identity>(await fetch(linkedin?'https://api.linkedin.com/v2/userinfo':'https://openidconnect.googleapis.com/v1/userinfo',{
    headers:{Authorization:`Bearer ${grant.access_token}`},signal:AbortSignal.timeout(15000),
  }));
  if(typeof identity.sub!=='string'||!identity.sub||identity.sub.length>256)throw new Error('Invalid provider identity');
  return {grant,identity};
}
async function accountStatement(env:AuthEnv,agentId:string,grant:Grant,identity:Identity) {
  const access=await encryptToken(env.TOKEN_ENCRYPTION_KEY,grant.access_token);
  const refresh=grant.refresh_token?await encryptToken(env.TOKEN_ENCRYPTION_KEY,grant.refresh_token):null;
  return env.DB.prepare(`INSERT INTO linkedin_accounts(agent_id,member_urn,member_name,member_picture,access_token_enc,refresh_token_enc,scopes,expires_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET member_urn=excluded.member_urn,member_name=excluded.member_name,
    member_picture=excluded.member_picture,access_token_enc=excluded.access_token_enc,refresh_token_enc=excluded.refresh_token_enc,
    scopes=excluded.scopes,expires_at=excluded.expires_at,connected_at=?,last_error=NULL`)
    .bind(agentId,`urn:li:person:${identity.sub}`,typeof identity.name==='string'?identity.name.slice(0,100):null,
      typeof identity.picture==='string'?identity.picture.slice(0,2048):null,access,refresh,grant.scope??null,new Date(Date.now()+grant.expires_in*1000).toISOString(),now());
}
export async function authCallback(request:Request,env:AuthEnv) {
  const params=new URL(request.url).searchParams;
  const state=params.get('state')??'';
  if(state.startsWith('native-')) {
    const flow=await env.DB.prepare(`UPDATE native_auth SET claimed_at=? WHERE id=? AND claimed_at IS NULL AND created_at>?
      RETURNING provider,redirect_uri,return_uri`).bind(now(),state,ago(flowLife)).first<{provider:string;redirect_uri:string;return_uri:string|null}>();
    if(!flow)return nativeCallbackPage(false);
    try {
      if(params.has('error')||!params.get('code'))throw new Error('Sign-in cancelled');
      const {grant,identity}=await exchange(env,flow.provider,params.get('code')!,flow.redirect_uri);
      const user=await provisionIdentity(env.DB,{provider:flow.provider,subject:flow.provider==='linkedin'?`urn:li:person:${identity.sub}`:identity.sub,name:identity.name??'ByLine author'});
      const statements:D1PreparedStatement[]=[];
      if(flow.provider==='linkedin')statements.push(await accountStatement(env,user.agentId,grant,identity));
      statements.push(env.DB.prepare('UPDATE native_auth SET user_id=? WHERE id=?').bind(user.userId,state));
      await env.DB.batch(statements);
      return nativeCallbackPage(true,flow.return_uri);
    }catch {
      await env.DB.prepare('UPDATE native_auth SET error=? WHERE id=?').bind('Sign-in failed. Please try again.',state).run();
      return nativeCallbackPage(false,flow.return_uri);
    }
  }
  const flow=await env.DB.prepare('DELETE FROM oauth_states WHERE state=? AND created_at>? RETURNING agent_id,return_uri').bind(state,ago(flowLife)).first<{agent_id:string;return_uri:string|null}>();
  if(!flow)return nativeCallbackPage(false);
  try {
    if(params.has('error')||!params.get('code'))throw new Error('Connection cancelled');
    const {grant,identity}=await exchange(env,'linkedin',params.get('code')!,new URL('/api/linkedin/callback',request.url).href);
    await (await accountStatement(env,flow.agent_id,grant,identity)).run();
    return nativeCallbackPage(true,flow.return_uri);
  }catch {return nativeCallbackPage(false,flow.return_uri);}
}
export async function connectLinkedIn(request:Request,env:AuthEnv,owner:Owner) {
  if(!capabilities(env).linkedin)throw new HttpError(503,'LinkedIn is not configured.');
  const p=new URL(request.url).searchParams;
  const returnUri=nativeReturnUri(p.get('returnUri'));
  if(p.has('returnUri')&&!returnUri)throw new HttpError(400,'invalid_return_uri');
  const state=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO oauth_states(state,agent_id,native,return_uri) VALUES(?,?,1,?)').bind(state,owner.agentId,returnUri).run();
  return json({url:authorizationUrl(env,'linkedin',state,new URL('/api/linkedin/callback',request.url).href)});
}
