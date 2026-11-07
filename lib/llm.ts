/**
 * Provider-agnostic LLM adapter. Everything above this file (persona.ts,
 * judge.ts, writer.ts) calls complete() and never knows the provider.
 *
 * Provider is chosen by LLM_PROVIDER (default "gemini"). An "anthropic"
 * branch is stubbed behind the same interface so switching is one env var.
 *
 * Free-tier design (see DEPLOY.md for the measured dashboard limits):
 * - CASCADE: primary GEMINI_MODEL -> GEMINI_FALLBACK_MODEL ->
 *   GEMINI_LAST_RESORT_MODEL. On 429/RESOURCE_EXHAUSTED the SAME request is
 *   retried on the next model; quotas are per model, so they stack.
 * - RPM: all calls are serialized with a minimum 4s gap (15 RPM ceiling on
 *   the Flash Lites; the spacing alone mathematically caps us at 15/min).
 * - RPD: per-model daily counters persisted in Postgres (llm_calls), keyed
 *   by Pacific-time day because Google resets free-tier quotas at midnight
 *   Pacific. A model at >=90% of its cap is skipped in the cascade.
 * - Gemma has a 16K TPM ceiling (vs 250K): callers may pass compactUser,
 *   used instead of user when a gemma model serves the call. Gemma also
 *   lacks systemInstruction and native JSON mode, so the adapter merges the
 *   system prompt into the content and instructs JSON in text.
 * - Never put secrets or env values into prompts; free-tier inputs may be
 *   used for model training.
 */
import { GoogleGenAI } from "@google/genai";
import { query } from "./db";
import { usageOwner, reserveUserCall, reserveProviderCall, recordAiUsage } from './ai-usage';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import type { CompleteArgs, CompleteResult } from "./llm-contract";
export type { CompleteArgs, CompleteResult } from "./llm-contract";
const MIN_GAP_MS = 4_000;
const DEFAULT_RPD: Record<string, number> = {}; // filled per call from env

function cascade(): string[] {
  return [
    process.env.GEMINI_MODEL,
    process.env.GEMINI_FALLBACK_MODEL,
    process.env.GEMINI_LAST_RESORT_MODEL,
  ].filter((m): m is string => Boolean(m));
}

function rpdCap(model: string): number {
  if (model === process.env.GEMINI_MODEL) {
    return Number(process.env.GEMINI_RPD_LIMIT) || 500;
  }
  if (model.startsWith("gemma")) return 14_400;
  return 500;
}

function isGemma(model: string): boolean {
  return model.startsWith("gemma");
}

// ---- pacing: serialize every call, >=4s apart, across the whole instance
let chain: Promise<void> = Promise.resolve();
let lastCallAt = 0;

function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ---- per-model daily counters (Pacific day, matching Google's quota reset)
export function pacificToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

async function todayCount(model: string): Promise<number> {
  const rows = await query<{ call_count: number }>(
    "SELECT call_count FROM llm_calls WHERE day = $1 AND model = $2",
    [pacificToday(), model],
  );
  return rows[0]?.call_count ?? 0;
}

async function bumpCount(model: string): Promise<void> {
  await query(
    `INSERT INTO llm_calls (day, model, call_count) VALUES ($1, $2, 1)
     ON CONFLICT (day, model) DO UPDATE SET call_count = llm_calls.call_count + 1`,
    [pacificToday(), model],
  );
}

/** Today's per-model call counts, for the UI and checkpoint reporting. */
export async function getTodayCalls(): Promise<{ model: string; calls: number; cap: number }[]> {
  const rows = await query<{ model: string; call_count: number }>(
    "SELECT model, call_count FROM llm_calls WHERE day = $1 ORDER BY model",
    [pacificToday()],
  );
  return rows.map((r) => ({ model: r.model, calls: r.call_count, cap: rpdCap(r.model) }));
}

// ---- gemini call
let genai: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!genai) genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return genai;
}

function is429(err: unknown): boolean {
  const s = String((err as Error)?.message ?? err);
  return /429|RESOURCE_EXHAUSTED|quota/i.test(s);
}

async function callGemini(model: string, args: CompleteArgs): Promise<string> {
  if(!await reserveProviderCall(model,pacificToday(),rpdCap(model)))throw new Error('provider_allowance_or_pacing_limit');
  const userText = isGemma(model) && args.compactUser ? args.compactUser : args.user;
  const jsonNudge = args.jsonMode
    ? "\n\nRespond with ONLY valid JSON. No markdown fences, no commentary."
    : "";

  const request = isGemma(model)
    ? {
        // Gemma: no systemInstruction, no native JSON mode — inline both.
        model,
        contents: `${args.system}\n\n---\n\n${userText}${jsonNudge}`,
        config: { maxOutputTokens: args.maxOutputTokens ?? 2048 },
      }
    : {
        model,
        contents: userText,
        config: {
          systemInstruction: args.system,
          maxOutputTokens: args.maxOutputTokens ?? 2048,
          ...(args.jsonMode ? { responseMimeType: "application/json" } : {}),
        },
      };

  const owner=await usageOwner();
  let res;
  try {res=await client().models.generateContent(request);}
  catch(e){await recordAiUsage(owner,model,false).catch(()=>{});throw e;}
  await recordAiUsage(owner,model,true,res.usageMetadata?.promptTokenCount,res.usageMetadata?.candidatesTokenCount).catch(()=>{});
  const text = res.text;
  if (!text || !text.trim()) throw new Error("empty completion");
  return text;
}

async function completeGemini(args: CompleteArgs): Promise<CompleteResult> {
  for (const model of cascade()) {
    // Skip models at >=90% of their daily cap rather than erroring into 429s.
    try {
      const used = await todayCount(model);
      if (used >= rpdCap(model) * 0.9) {
        console.warn(`[llm] ${model} at ${used}/${rpdCap(model)} daily calls — skipping`);
        continue;
      }
    } catch {
      // counter unavailable (db hiccup) — proceed; the API enforces anyway
    }

    // One retry on transient (non-429) errors, then cascade onward.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await paced(() => callGemini(model, args));
        await bumpCount(model).catch(() => {});
        console.log(`[llm] served by ${model}`);
        return { ok: true, text, model };
      } catch (err) {
        if (is429(err)) {
          console.warn(`[llm] ${model} rate-limited — cascading to next model`);
          break; // next model in cascade
        }
        console.warn(`[llm] ${model} attempt ${attempt + 1} failed:`, String((err as Error)?.message ?? err));
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  }
  return { ok: false, reason: "all_models_failed_or_exhausted" };
}

/** The single entry point. Never throws. */
export async function complete(args: CompleteArgs): Promise<CompleteResult> {
  if(process.env.BYLINE_TEST_MODE === "true") return {ok:false, reason:"local_test_ai_disabled"};
  if(process.env.BYLINE_ZERO_BUDGET_STATE_FILE) {
    try {
      const guard=JSON.parse(await readFile(process.env.BYLINE_ZERO_BUDGET_STATE_FILE,'utf8'));
      if(guard.billingEnabled!==false||!Number.isFinite(guard.verifiedUntil)||guard.verifiedUntil<=Date.now()||guard.keyHash!==createHash('sha256').update(process.env.GEMINI_API_KEY??'').digest('hex'))return {ok:false,reason:'free_tier_verification_required'};
    }catch{return {ok:false,reason:'free_tier_verification_required'};}
  }
  const provider = process.env.LLM_PROVIDER ?? "gemini";
  if (provider === "anthropic") {
    // Stub kept behind the same interface: switching providers is one env
    // var (LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY) plus filling this in.
    return { ok: false, reason: "anthropic_provider_not_implemented" };
  }
  if (!process.env.GEMINI_API_KEY) return { ok: false, reason: "missing_gemini_api_key" };
  try {
    if(!await reserveUserCall(await usageOwner(),pacificToday()))return {ok:false,reason:'daily_ai_allowance_reached'};
    return await completeGemini(args);
  } catch (err) {
    return { ok: false, reason: String((err as Error)?.message ?? err) };
  }
}

/**
 * Strict JSON helper: strips accidental fences, parses, and validates with
 * the caller's guard. Used by judge/writer so a malformed response can never
 * publish unscored content.
 */
export { parseJson } from "./llm-contract";
