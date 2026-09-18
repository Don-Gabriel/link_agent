import {after,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
export const dynamic='force-dynamic';
export const maxDuration=300;
/** Acknowledge quickly; the existing tick owns durable locks and resumable work. */
export async function GET(request:Request) {
  const secret=process.env.CRON_SECRET;
  const supplied=request.headers.get('x-cron-secret')??'';
  if(!secret || secret.length<16 || Buffer.byteLength(supplied)!==Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(secret)))
    return new NextResponse(null,{status:404});
  const port=Number(process.env.PORT)||3000;
  after(async()=>{
    try {
      const response=await fetch(`http://127.0.0.1:${port}/api/cron/tick`,{headers:{'X-Cron-Secret':secret},signal:AbortSignal.timeout(280_000)});
      await response.arrayBuffer();
      if(!response.ok)console.warn('[scheduler] Tick failed; the next wake will retry due work.');
    }catch{console.warn('[scheduler] Tick interrupted; inspect scheduler health.');}
  });
  return NextResponse.json({accepted:true},{status:202,headers:{'Cache-Control':'no-store'}});
}
