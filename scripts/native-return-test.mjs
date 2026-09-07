import assert from 'node:assert/strict';
import {randomBytes, createHash, randomUUID} from 'node:crypto';
import pg from 'pg';
import {localEnv} from './local-env.mjs';
const env=localEnv(), base=`http://127.0.0.1:${env.PORT}`;
const db=new pg.Pool({connectionString:env.DATABASE_URL});
let checks=0;
function check(value,message){assert.ok(value,message);checks++;console.log(`ok ${message}`);}
async function post(body){return fetch(base+'/api/native-auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
try {
  const mode=await (await fetch(base+'/api/native-auth')).json();
  assert.equal(mode.localTest,true); // never seed flows in live storage
  const verifier=randomBytes(48).toString('base64url');
  const returnUri=`http://127.0.0.1:54321/byline-return/${randomBytes(32).toString('base64url')}`;
  const id=`native-${randomUUID()}`;
  await db.query('INSERT INTO native_auth(id,provider,verifier_hash,redirect_uri,return_uri) VALUES($1,$2,$3,$4,$5)',[id,'linkedin',createHash('sha256').update(verifier).digest('hex'),base+'/api/linkedin/callback',returnUri]);
  const cancelled=await fetch(base+`/api/linkedin/callback?state=${id}&error=access_denied`,{redirect:'manual'});
  const html=await cancelled.text();
  check(cancelled.status===400&&!cancelled.headers.get('location')&&html.includes(returnUri),'cancelled desktop sign-in retains its app return and avoids the old site');
  check(!html.includes(verifier)&&!html.includes('access_denied'),'browser return contains no verifier or provider payload');
  const wrong=await (await post({action:'poll',id,verifier:randomBytes(48).toString('base64url')})).json();
  check(wrong.pending===true,'wrong verifier cannot consume a completed attempt');
  const failure=await post({action:'poll',id,verifier});
  check(failure.status===400&&(await failure.json()).error==='sign_in_failed','app receives cancellation through the protected polling API');
  const replay=await fetch(base+`/api/linkedin/callback?state=${id}&code=not-a-provider-code`,{redirect:'manual'});
  check(replay.status===400&&!replay.headers.get('location')&&(await replay.text()).includes('Return to ByLine'),'replayed native callback stays on ByLine recovery page');
  for(const path of ['/api/linkedin/callback','/api/native-auth/callback?state=expired']) {
    const r=await fetch(base+path,{redirect:'manual'});
    check(r.status===400&&!r.headers.get('location'),'missing or expired callback does not redirect to the legacy website');
  }
  const invalid=await post({provider:'linkedin',verifier,returnUri:'https://external.example/'});
  check(invalid.status===400&&(await invalid.json()).error==='invalid_return_uri','external return destinations are rejected');
  const state=`app-${randomUUID()}`;
  const agent=(await db.query('SELECT id FROM agents WHERE owner_id IS NOT NULL LIMIT 1')).rows[0].id;
  await db.query('INSERT INTO oauth_states(state,agent_id,native,return_uri) VALUES($1,$2,true,$3)',[state,agent,returnUri]);
  const reconnect=await fetch(base+`/api/linkedin/callback?state=${state}&error=access_denied`,{redirect:'manual'});
  check(reconnect.status===400&&(await reconnect.text()).includes(returnUri),'LinkedIn reconnection uses the same desktop return on cancellation');
  check((await db.query('SELECT 1 FROM oauth_states WHERE state=$1',[state])).rowCount===0,'cancelled reconnect state is consumed');
  console.log(`${checks} native-return checks passed; no provider exchange or publishing calls.`);
} finally {await db.end();}
