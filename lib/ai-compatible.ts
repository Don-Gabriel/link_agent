import { boundedText } from './http-body';
import type { CompleteArgs, CompleteResult } from './llm-contract';

/** Runtime-neutral wire adapter: no SDK, provider fallback, billing or global state. */
export interface CompatibleConfig {
  baseUrl: string;
  model: string;
  token?: string;
  timeoutMs: number;
  maxInputBytes: number;
  maxOutputTokens: number;
  disableThinking: boolean;
}
export interface AiSettings {
  AI_BASE_URL?:string; AI_MODEL?:string; AI_SERVICE_TOKEN?:string; AI_ALLOW_LOCAL_HTTP?:string;
  AI_TIMEOUT_MS?:string; AI_MAX_INPUT_BYTES?:string; AI_MAX_OUTPUT_TOKENS?:string; AI_DISABLE_THINKING?:string;
}
export function positiveInteger(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error('ai_configuration_invalid');
  return n;
}
export function compatibleConfig(env: AiSettings): CompatibleConfig {
  let url: URL;
  try { url = new URL(env.AI_BASE_URL ?? ''); } catch { throw new Error('ai_configuration_invalid'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:' && env.AI_ALLOW_LOCAL_HTTP === 'true')) ||
      (!local && (!env.AI_SERVICE_TOKEN || env.AI_SERVICE_TOKEN.length < 32))) throw new Error('ai_configuration_invalid');
  if (env.AI_SERVICE_TOKEN && /[\r\n]/.test(env.AI_SERVICE_TOKEN)) throw new Error('ai_configuration_invalid');
  return { baseUrl: url.href.replace(/\/$/, ''), token: env.AI_SERVICE_TOKEN, ...requestConfig(env) };
}
export function requestConfig(env:AiSettings):Omit<CompatibleConfig,'baseUrl'|'token'> {
  const model = env.AI_MODEL?.trim();
  if (!model || model.length > 200 || /[\r\n]/.test(model)) throw new Error('ai_configuration_invalid');
  return {
    model,
    timeoutMs: positiveInteger(env.AI_TIMEOUT_MS, 90000, 120000),
    maxInputBytes: positiveInteger(env.AI_MAX_INPUT_BYTES, 64000, 128000),
    maxOutputTokens: positiveInteger(env.AI_MAX_OUTPUT_TOKENS, 8192, 16384),
    disableThinking: env.AI_DISABLE_THINKING === 'true',
  };
}
export const isRetryableAiReason = (reason: string) =>
  ['ai_busy', 'ai_circuit_open', 'ai_retry_later', 'provider_unavailable', 'provider_timeout', 'provider_overloaded'].includes(reason) ||
  /^provider_http_5\d\d$/.test(reason);

function retryDelay(value: string | null): number {
  if (!value) return 15000;
  const ms = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.min(300000, Math.max(1000, ms)) : 15000;
}
const tokenCount = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

export async function compatibleComplete(config: CompatibleConfig, args: CompleteArgs, requestId?: string, fetcher: typeof fetch = fetch): Promise<CompleteResult> {
  const maxTokens = args.maxOutputTokens ?? 2048;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > config.maxOutputTokens)
    return { ok: false, reason: 'ai_output_budget_exceeded' };
  const payload = JSON.stringify({
    model: config.model, stream: false, temperature: 0.6, max_tokens: maxTokens,
    messages: [{ role: 'system', content: args.system }, { role: 'user', content: args.user }],
    ...(args.jsonMode ? { response_format: args.jsonSchema
      ? { type: 'json_schema', json_schema: { name: 'byline_response', strict: true, schema: args.jsonSchema } }
      : { type: 'json_object' } } : {}),
    ...(config.disableThinking ? { reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false } } : {}),
  });
  if (new TextEncoder().encode(payload).byteLength > config.maxInputBytes) return { ok: false, reason: 'ai_input_too_large' };
  try {
    const response = await fetcher(`${config.baseUrl}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
      headers: { 'Content-Type': 'application/json', ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        ...(requestId ? { 'X-Request-ID': requestId } : {}) }, body: payload,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429 || response.status === 503) return { ok: false, reason: 'provider_overloaded', retryAfterMs: retryDelay(response.headers.get('retry-after')) };
      return { ok: false, reason: `provider_http_${response.status}` };
    }
    const body = await boundedText(response, 256 * 1024);
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { return { ok: false, reason: 'provider_invalid_json' }; }
    const data = raw as { choices?: { finish_reason?: string; message?: { content?: unknown; refusal?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; neurons?: unknown } };
    const choice = data?.choices?.[0], content = choice?.message?.content;
    if (choice?.finish_reason !== 'stop' || typeof content !== 'string' || !content.trim() || choice.message?.refusal)
      return { ok: false, reason: 'incomplete_or_blocked_completion' };
    if (args.jsonMode) {
      try { JSON.parse(content); } catch { return { ok: false, reason: 'provider_invalid_json' }; }
    }
    return { ok: true, text: content, model: config.model,
      usage: { inputTokens: tokenCount(data.usage?.prompt_tokens), outputTokens: tokenCount(data.usage?.completion_tokens),
        ...(typeof data.usage?.neurons==='number'&&Number.isFinite(data.usage.neurons)&&data.usage.neurons>=0?{neurons:data.usage.neurons}:{}) } };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if(name==='WorkersAiQuotaError')return {ok:false,reason:'provider_quota_reached'};
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'provider_timeout' : 'provider_unavailable' };
  }
}
