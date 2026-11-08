import { compatibleComplete, requestConfig, type CompatibleConfig } from '../../lib/ai-compatible';
import type { CompleteArgs } from '../../lib/llm-contract';
import type { AppEnv } from './env';

// Explicitly validated wire contract; add other models only after schema/quality tests.
export const WORKERS_AI_MODEL='@cf/qwen/qwen3.8-27b';
export const WORKERS_AI_MODELS=[WORKERS_AI_MODEL,'@cf/zai-org/glm-4.7-flash'] as const;
export type WorkersAiModel=typeof WORKERS_AI_MODELS[number];
export function workersAiConfig(env:AppEnv):CompatibleConfig {
  if(!env.AI||!WORKERS_AI_MODELS.includes(env.AI_MODEL as WorkersAiModel))throw new Error('ai_configuration_invalid');
  return {...requestConfig(env),baseUrl:'workers-ai://binding'};
}
export function workersAiComplete(env:AppEnv,config:CompatibleConfig,args:CompleteArgs,id:string) {
  return compatibleComplete(config,args,id,async(_url,init)=>{
    const input=JSON.parse(String(init?.body)) as AiModels[typeof WORKERS_AI_MODEL]['inputs'];
    // Qwen 3.8 accepts low/medium/xhigh; disabling thinking uses the template setting.
    delete input.reasoning_effort;
    if(!config.disableThinking&&config.model===WORKERS_AI_MODEL)input.reasoning_effort='low';
    try {
      if(!env.AI)return new Response(null,{status:503});
      return await env.AI.run(config.model as WorkersAiModel,input,{returnRawResponse:true,signal:init?.signal??undefined});
    }catch(error) {
      // Never return/log raw SDK errors: some include the request or service details.
      const code=error instanceof Error?/\b(30\d\d|50\d\d)\b/.exec(error.message)?.[1]:undefined;
      if(code==='3036')throw Object.assign(new Error('Daily inference quota reached'),{name:'WorkersAiQuotaError'});
      if(code==='3040')return new Response(null,{status:503,headers:{'Retry-After':'30'}});
      if(code==='5035')return new Response(null,{status:403});
      if(code==='5016')return new Response(null,{status:403});
      if(code==='5007')return new Response(null,{status:400});
      if(code==='5028')return new Response(null,{status:410});
      if(code==='3007'||code==='3008')return new Response(null,{status:504});
      throw error;
    }
  });
}
