/**
 * Provider-agnostic LLM adapter. Everything above this file (persona.ts,
 * judge.ts, writer.ts) calls complete() and never knows the provider.
 *
 * Provider is chosen by LLM_PROVIDER (default "gemini"). An "anthropic"
 * branch is stubbed behind the same interface so switching is one env var.
 *
 * Native clients use their own encrypted key and selected model, with account
 * quotas and database-backed pacing. No environment-key fallback is allowed.
 * The cascade below is retained only for the private legacy installation.
 * Its historically configured model limits are local safeguards, not a claim
 * about the current quota granted by Google to any client's project.
 * Legacy design (see DEPLOY.md for the measured dashboard limits):
 * - CASCADE: primary GEMINI_MODEL -> GEMINI_FALLBACK_MODEL ->
 *   GEMINI_LAST_RESORT_MODEL. On 429/RESOURCE_EXHAUSTED the SAME request is
 *   retried on the next model; quotas are per model, so they stack.
 * - RPM: database reservations space each account/model's calls by 4s.
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
import { readAiCredential, aiErrorCode, setAiError } from './ai-credentials';

export interface CompleteArgs {
  system: string;
  user: string;
  /** Smaller prompt variant for low-TPM models (Gemma). Optional. */
  compactUser?: string;
  jsonMode?: boolean;
  maxOutputTokens?: number;
}

export type CompleteResult =
  | { ok: true; text: string; model: string }
  | { ok: false; reason: string };

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
    `SELECT model, count(*)::int AS call_count FROM ai_usage
      WHERE owner=$1 AND (created_at AT TIME ZONE 'America/Los_Angeles')::date=$2::date GROUP BY model ORDER BY model`,
    [await usageOwner(), pacificToday()],
  );
  return rows.map((r) => ({ model: r.model, calls: r.call_count, cap: rpdCap(r.model) }));
}

// ---- gemini call

async function callGemini(model: string, args: CompleteArgs, apiKey: string, owner: string): Promise<string> {
  if(!await reserveUserCall(owner,pacificToday()))throw new Error('daily_ai_allowance_reached');
  if(!await reserveProviderCall(model,pacificToday(),rpdCap(model),owner))throw new Error('provider_allowance_or_pacing_limit');
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

  let res;
  try {res=await new GoogleGenAI({apiKey,httpOptions:{timeout:60_000,retryOptions:{attempts:1}}}).models.generateContent(request);}
  catch(e){await recordAiUsage(owner,model,false).catch(()=>{});throw e;}
  await recordAiUsage(owner,model,true,res.usageMetadata?.promptTokenCount,res.usageMetadata?.candidatesTokenCount).catch(()=>{});
  const text = res.text;
  if (!text || !text.trim()) throw new Error("empty completion");
  return text;
}

async function completeGemini(args: CompleteArgs, apiKey:string, owner:string, models:string[]): Promise<CompleteResult> {
  let failure='ai_provider_unavailable';
  for (const model of models) {
    // Skip models at >=90% of their daily cap rather than erroring into 429s.
    try {
      const used = owner==='legacy-owner' ? await todayCount(model) : 0;
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
        const text = await callGemini(model, args, apiKey, owner);
        if(owner==='legacy-owner')await bumpCount(model).catch(() => {});
        await setAiError(owner,null).catch(()=>{});
        console.log(`[llm] served by ${model}`);
        return { ok: true, text, model };
      } catch (err) {
        const raw=(err as Error)?.message;
        failure = raw==='daily_ai_allowance_reached' || raw==='provider_allowance_or_pacing_limit' ? 'ai_quota_exhausted' : aiErrorCode(err);
        await setAiError(owner,failure).catch(()=>{});
        if(failure!=='ai_provider_unavailable') {
          if(owner!=='legacy-owner')return {ok:false,reason:failure};
          break;
        }
        console.warn(`[llm] ${model} attempt ${attempt + 1} failed: ${failure}`);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  }
  return { ok: false, reason: failure };
}

/** The single entry point. Never throws. */
export async function complete(args: CompleteArgs): Promise<CompleteResult> {
  if(process.env.BYLINE_TEST_MODE === "true") return {ok:false, reason:"local_test_ai_disabled"};
  const owner=await usageOwner();
  if(owner==='unattributed')return {ok:false,reason:'ai_key_required'};
  // Native users always bring their own key. Missing, invalid, or exhausted
  // credentials must never fall back to the operator's environment key.
  if(owner!=='legacy-owner') {
    try {
      const credential=await readAiCredential(owner);
      if(!credential)return {ok:false,reason:'ai_key_required'};
      return await completeGemini(args,credential.apiKey,owner,[credential.model]);
    } catch {return {ok:false,reason:'ai_configuration_unavailable'};}
  }
  if(process.env.BYLINE_ALLOW_LEGACY_AUTH==='false')return {ok:false,reason:'ai_key_required'};
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
    return await completeGemini(args,process.env.GEMINI_API_KEY,owner,cascade());
  } catch (err) {
    return { ok: false, reason: aiErrorCode(err) };
  }
}

/**
 * Strict JSON helper: strips accidental fences, parses, and validates with
 * the caller's guard. Used by judge/writer so a malformed response can never
 * publish unscored content.
 */
export function parseJson<T>(text: string, guard: (v: unknown) => v is T): T | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed: unknown = JSON.parse(cleaned);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
