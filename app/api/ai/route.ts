import { NextResponse } from 'next/server';
import { requestIdentity } from '../../../lib/request-agent';
import { query } from '../../../lib/db';
import { aiStatus,aiModels,aiErrorCode,AI_MESSAGES,reserveKeyCheck,saveAiCredential,validateAiKey } from '../../../lib/ai-credentials';
export const dynamic='force-dynamic';
export const maxDuration=60;
const json=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{'Cache-Control':'no-store'}});

export async function GET() {
  const user=await requestIdentity();
  if(!user)return json({error:'unauthorized'},401);
  return json(await aiStatus(user.userId));
}

export async function POST(request:Request) {
  const user=await requestIdentity();
  if(!user)return json({error:'unauthorized'},401);
  if(process.env.BYLINE_TEST_MODE==='true')return json({error:'Live AI connections are disabled in the local preview.'},409);
  const b=await request.json().catch(()=>null);
  if(!b || typeof b.apiKey!=='string' || !/^[A-Za-z0-9_.-]{20,2048}$/.test(b.apiKey.trim()) ||
    !aiModels().includes(b.model) || !['free','paid'].includes(b.dataPolicy) || b.acceptedTerms!==true)
    return json({error:'Check your key, model, and data-use acknowledgement.'},400);
  if(!await reserveKeyCheck(user.userId))return json({error:'Wait before testing again. Up to 10 connection tests are allowed per hour.'},429);
  try {
    await validateAiKey(b.apiKey.trim(),b.model);
    await saveAiCredential(user.userId,b.apiKey.trim(),b.model,b.dataPolicy);
    return json(await aiStatus(user.userId));
  } catch(e) {
    const code=aiErrorCode(e);
    return json({error:code,detail:AI_MESSAGES[code]},code==='ai_quota_exhausted'?429:400);
  }
}

export async function DELETE() {
  const user=await requestIdentity();
  if(!user)return json({error:'unauthorized'},401);
  await query('DELETE FROM byline_ai_credentials WHERE user_id=$1',[user.userId]);
  return json(await aiStatus(user.userId));
}
