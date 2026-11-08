/** Real, opt-in Workers AI calls. No application DB, routes or customer data. */
import { getPlatformProxy } from 'wrangler';
import { evaluateAi } from '../../scripts/ai-evaluate';
import { workersAiConfig, workersAiComplete, WORKERS_AI_MODEL, type WorkersAiModel } from '../src/ai-workers';
import type { AppEnv } from '../src/env';

async function main() {
  if (!process.argv.includes('--run-free')) throw new Error('Confirm the account is on Workers Free, then pass --run-free. This makes real inference calls.');
  const proxy = await getPlatformProxy({ configPath: 'eval.wrangler.jsonc', envFiles: [], persist: false });
  try {
    // Node's platform proxy cannot serialize AbortSignal. Production calls the
    // binding in workerd directly; this evaluation removes only that proxy option.
    const binding = proxy.env.AI as Ai;
    const ai = {run: (model: WorkersAiModel, input: AiModels[typeof WORKERS_AI_MODEL]['inputs']) =>
      binding.run(model, input, {returnRawResponse: true})} as Ai;
    const env = { AI: ai, AI_MODEL: process.env.AI_MODEL??WORKERS_AI_MODEL, AI_DISABLE_THINKING: process.env.AI_DISABLE_THINKING??'true' } as AppEnv;
    const config = workersAiConfig(env);
    await evaluateAi(args => workersAiComplete(env, config, args, crypto.randomUUID()), config.model,{disableThinking:config.disableThinking,timeoutMs:config.timeoutMs,proxySignalOmitted:true});
  } finally { await proxy.dispose(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Evaluation failed'); process.exitCode = 1; });
