// Local operator access through an existing Firebase CLI login. Never ship to clients.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require=createRequire(import.meta.url);
export async function googleOperatorToken() {
  return (await googleOperatorCredentials()).accessToken;
}
export async function googleOperatorCredentials() {
  const root=process.env.APPDATA?path.join(process.env.APPDATA,'npm/node_modules'):execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
  const auth=require(path.join(root,'firebase-tools/lib/auth.js'));
  const account=auth.getGlobalDefaultAccount();
  if(!account)throw new Error('Sign into the Firebase CLI first.');
  const token=await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes??[]);
  return {accessToken:token.access_token,expiresAt:token.expires_at??Date.now()+45*60_000};
}
export async function googleOperatorFetch(url,options={}) {
  const token=await googleOperatorToken();
  return fetch(url,{...options,headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(20000)});
}
