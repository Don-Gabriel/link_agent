import { authenticate,authCallback,nativeAuth,connectLinkedIn } from './auth';
import { json,HttpError } from './http';
import { onboardingRoute } from './onboarding';
import { slotsRoute } from './slots';
import { statusRoute } from './status';
import { settingsRoute,interestsRoute } from './settings';
import { postsRoute,postAction,rewriteRoute } from './posts';
import { devicesRoute } from './notifications';
import { mediaRoute } from './media';
import { deleteAccount } from './delete-account';
import { reviewRoute,cycleRoute } from './scheduler';
import type { AppEnv } from './env';
export { ContentWorkflow } from './workflow';
export { MaintenanceWorkflow } from './scheduler';

export default {
  async fetch(request:Request,env:AppEnv):Promise<Response> {
    try {
      const path=new URL(request.url).pathname,method=request.method;
      if(path==='/api/health'&&method==='GET') {
        try {
          await env.DB.prepare('SELECT 1').first();
          if(new URL(request.url).searchParams.get('check')==='scheduler') {
            const heartbeat=await env.DB.prepare("SELECT updated_at FROM system_status WHERE key='cloud_scheduler'").first<{updated_at:string}>();
            const healthy=!!heartbeat&&Date.now()-Date.parse(heartbeat.updated_at)<16*60000;
            return json({ok:healthy,db:'ok',scheduler:{healthy,lastTickAt:heartbeat?.updated_at??null}},healthy?200:503);
          }
          return json({ok:true,db:'ok',service:'byline-cloud'});
        }
        catch{return json({ok:false,db:'unavailable'},503);}
      }
      if(path==='/api/native-auth'&&['GET','POST'].includes(method))return await nativeAuth(request,env);
      if(['/api/linkedin/callback','/api/native-auth/callback'].includes(path)&&method==='GET')return await authCallback(request,env);
      const owner=await authenticate(request,env);
      if(!owner)return json({error:'unauthorized'},401);
      if(path==='/api/auth'&&method==='DELETE') {
        await env.DB.prepare('UPDATE byline_sessions SET revoked_at=? WHERE id=? AND user_id=?').bind(new Date().toISOString(),owner.sessionId,owner.userId).run();
        return json({ok:true});
      }
      if(path==='/api/onboarding'&&['GET','POST'].includes(method))return await onboardingRoute(request,env,owner);
      if(path==='/api/status'&&method==='GET')return await statusRoute(env,owner);
      if(path==='/api/settings'&&method==='PATCH')return await settingsRoute(request,env.DB,owner);
      if(path==='/api/interests'&&['GET','POST'].includes(method))return await interestsRoute(request,env.DB,owner);
      if(path==='/api/posts'&&['GET','POST'].includes(method))return await postsRoute(request,env,owner);
      const post=/^\/api\/posts\/([1-9][0-9]{0,8})$/.exec(path);
      if(post&&method==='PATCH')return await postAction(request,env,owner,Number(post[1]));
      if(path==='/api/compose/rewrite'&&method==='POST')return await rewriteRoute(request,env,owner);
      if(path==='/api/style/preview'&&method==='POST')return await rewriteRoute(request,env,owner,true);
      if(path==='/api/review-delivery'&&['GET','POST'].includes(method))return await reviewRoute(request,env,owner);
      if(path==='/api/cycle/run'&&method==='POST')return await cycleRoute(env,owner);
      if(path==='/api/devices'&&['POST','DELETE'].includes(method))return await devicesRoute(request,env,owner);
      if(path==='/api/media'&&method==='POST')return await mediaRoute(request,env,owner);
      if(path==='/api/account/delete'&&method==='POST')return await deleteAccount(request,env.DB,owner);
      if(path==='/api/linkedin/connect'&&method==='GET')return await connectLinkedIn(request,env,owner);
      if(path==='/api/linkedin/disconnect'&&method==='POST') {
        await env.DB.batch([env.DB.prepare('DELETE FROM linkedin_accounts WHERE agent_id=?').bind(owner.agentId),env.DB.prepare('UPDATE agents SET auto_publish=0,revision=revision+1 WHERE id=?').bind(owner.agentId)]);
        return json({ok:true});
      }
      if(path==='/api/slots'&&['GET','POST'].includes(method))return await slotsRoute(request,env.DB,owner);
      const slot=/^\/api\/slots\/([a-f0-9-]{36})$/.exec(path);
      if(slot&&['PATCH','DELETE'].includes(method))return await slotsRoute(request,env.DB,owner,slot[1]);
      return json({error:'not_found'},404);
    } catch(error) {
      if(error instanceof HttpError)return json({error:error.message},error.status);
      console.error(JSON.stringify({event:'request_failed',path:new URL(request.url).pathname}));
      return json({error:'The request could not be completed. Please try again.'},500);
    }
  },
  async scheduled(event:ScheduledController,env:AppEnv) {
    const id=`tick-${Math.floor(event.scheduledTime/300000)}`;
    await env.MAINTENANCE.createBatch([{id,params:{cleanup:new Date(event.scheduledTime).getUTCMinutes()===0}}]);
  },
} satisfies ExportedHandler<AppEnv>;
