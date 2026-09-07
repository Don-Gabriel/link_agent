import { after, NextResponse } from 'next/server';
import { requestIdentity } from '../../../lib/request-agent';
import { query } from '../../../lib/db';
import {timetableDay,manualOccurrences} from '../../../lib/timetable-home';
import {runSlotCycle} from '../../../lib/cycle';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET() {
  const user=await requestIdentity();
  if(!user)return NextResponse.json({error:'unauthorized'},{status:401});
  const [agent]=await query<{id:string;timezone:string;paused:boolean}>('SELECT id,timezone,paused FROM agents WHERE owner_id=$1 AND active',[user.userId]);
  if(!agent)return NextResponse.json({error:'Finish setup first.'},{status:409});
  const day=await timetableDay(agent.id,agent.timezone,agent.paused);
  return NextResponse.json(day,{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request) {
  const user=await requestIdentity();
  if(!user)return NextResponse.json({error:'unauthorized'},{status:401});
  const b=await request.json().catch(()=>null);
  if(b?.action==='generate') {
    const [a]=await query<{id:string;timezone:string;paused:boolean}>(`SELECT a.id,a.timezone,a.paused FROM agents a JOIN onboarding o ON o.user_id=a.owner_id WHERE a.owner_id=$1 AND a.active AND o.completed_at IS NOT NULL`,[user.userId]);
    if(!a)return NextResponse.json({error:'Finish setup first.'},{status:409});
    if(a.paused)return NextResponse.json({error:'Resume ByLine in Settings before preparing a post.'},{status:409});
    if(b.slotIds!==undefined && (!Array.isArray(b.slotIds)||b.slotIds.some((id:unknown)=>typeof id!=='string')))return NextResponse.json({error:'Choose valid timetable entries.'},{status:400});
    const occurrences=await manualOccurrences(a.id,a.timezone,b.slotIds??[]);
    after(async()=>{for(const occurrence of occurrences)await runSlotCycle(occurrence,true);});
    return NextResponse.json({ok:true,accepted:occurrences.length>0,count:occurrences.length}, {status:202});
  } else if(b?.action==='schedule'||b?.action==='test-now') {
    return NextResponse.json({error:'Posting times are now managed in Timetable. Update ByLine to use the unified schedule.'},{status:409});
  } else if(b?.action==='notifications'&&['enabled','denied','unavailable'].includes(b.notifications)) {
    await query(`UPDATE onboarding SET config=config||$2::jsonb WHERE user_id=$1`,[user.userId,JSON.stringify({notifications:b.notifications})]);
  } else return NextResponse.json({error:'invalid_action'},{status:400});
  return NextResponse.json({ok:true});
}
