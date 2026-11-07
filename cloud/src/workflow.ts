import { WorkflowEntrypoint,type WorkflowEvent,type WorkflowStep } from 'cloudflare:workers';
import { generateJob } from './generation';
import type { GenerationJob } from './jobs';
import type { AppEnv } from './env';
import { drainNotifications } from './notifications';

export class ContentWorkflow extends WorkflowEntrypoint<AppEnv,GenerationJob> {
  async run(event:WorkflowEvent<GenerationJob>,step:WorkflowStep) {
    // A failed feed is optional: move to the other publishers instead of
    // retrying it until it consumes discovery's shared external-request budget.
    // Judging/writing and database steps retain durable outage retries.
    const result=await generateJob(this.env,event.instanceId,event.payload,(name,work)=>step.do(name,{retries:{limit:name.startsWith('source:')?0:2,delay:'15 seconds',backoff:'exponential'},timeout:'3 minutes'},work));
    try {
      const key='seq' in result?`draft:${event.payload.agentId}:${result.seq}`:`generation-failed:${event.instanceId}`;
      await step.do('notify-outcome',{retries:{limit:2,delay:'15 seconds',backoff:'exponential'}},()=>drainNotifications(this.env,key));
    }catch { console.warn(JSON.stringify({event:'notification_delivery_deferred',job:event.instanceId})); }
    // The outbox remains available to the scheduled dispatcher if delivery fails.
    return result;
  }
}
