import { completeNativeAuth } from '../../../../lib/native-auth';
import { nativeCallbackPage } from '../../../../lib/native-callback';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const p=new URL(request.url).searchParams;
  const flow=await completeNativeAuth(p.get('state')??'',p.get('code'),p.has('error'));
  return nativeCallbackPage(flow?.ok ?? false, flow?.returnUri);
}
