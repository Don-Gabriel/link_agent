import { GoogleGenAI } from '@google/genai';
import { query } from './db';
import { encrypt, decrypt } from './crypto';

export const AI_MESSAGES: Record<string, string> = {
  ai_key_required: 'Connect your Gemini key in Settings → Gemini to prepare drafts.',
  ai_key_invalid: 'Your Gemini key was rejected. Replace it in Settings → Gemini.',
  ai_quota_exhausted: 'Your Google project has reached its Gemini allowance. Wait for it to reset or check your project in AI Studio.',
  ai_model_unavailable: 'This model is unavailable for your Google project. Choose another model in Settings → Gemini.',
  ai_provider_unavailable: 'Gemini is temporarily unavailable. Your settings are saved; please try again later.',
  ai_configuration_unavailable: 'Your AI connection could not be read. Please contact your ByLine operator.',
};

export function aiModels(): string[] {
  return [...new Set((process.env.BYLINE_GEMINI_MODELS ?? process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite')
    .split(',').map(v => v.trim()).filter(v => /^gemini-[a-z0-9.-]+$/.test(v)))];
}

/** Provider error bodies can contain credentials. Never return or log them. */
export function aiErrorCode(error: unknown): string {
  const e = error as { status?: number; message?: string };
  const status = Number(e?.status);
  const message = String(e?.message ?? '');
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(message)) return 'ai_quota_exhausted';
  if ([401, 403].includes(status) || /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|UNAUTHENTICATED/i.test(message)) return 'ai_key_invalid';
  if (status === 404 || /NOT_FOUND|not supported.*model|model.*not found/i.test(message)) return 'ai_model_unavailable';
  return 'ai_provider_unavailable';
}

export async function aiStatus(userId: string) {
  const [row] = await query<{ key_hint: string; model: string; data_policy: string; validated_at: Date; last_error: string | null }>(
    'SELECT key_hint,model,data_policy,validated_at,last_error FROM byline_ai_credentials WHERE user_id=$1', [userId]);
  return {
    connected: !!row, keyHint: row?.key_hint ?? null, model: row?.model ?? aiModels()[0] ?? '',
    models: aiModels(), dataPolicy: row?.data_policy ?? null, validatedAt: row?.validated_at ?? null,
    error: row?.last_error ?? null, message: row?.last_error ? AI_MESSAGES[row.last_error] ?? AI_MESSAGES.ai_provider_unavailable : null,
  };
}

export async function readAiCredential(userId: string) {
  const [row] = await query<{key_enc:string;model:string;data_policy:string}>(
    'SELECT key_enc,model,data_policy FROM byline_ai_credentials WHERE user_id=$1', [userId]);
  if (!row) return null;
  return { apiKey: decrypt(row.key_enc, `byline-gemini:${userId}`), model: row.model, dataPolicy: row.data_policy };
}

export async function saveAiCredential(userId:string,apiKey:string,model:string,dataPolicy:'free'|'paid') {
  const encrypted = encrypt(apiKey, `byline-gemini:${userId}`);
  await query(`INSERT INTO byline_ai_credentials(user_id,key_enc,key_hint,model,data_policy) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(user_id) DO UPDATE SET key_enc=EXCLUDED.key_enc,key_hint=EXCLUDED.key_hint,model=EXCLUDED.model,
    data_policy=EXCLUDED.data_policy,validated_at=now(),last_error=NULL`, [userId, encrypted, apiKey.slice(-4), model, dataPolicy]);
}

export async function setAiError(userId:string,code:string|null) {
  if (userId === 'legacy-owner') return;
  await query('UPDATE byline_ai_credentials SET last_error=$2 WHERE user_id=$1', [userId, code]);
}

/** Atomic account-level throttle also bounds failed validation requests. */
export async function reserveKeyCheck(userId:string) {
  const rows = await query(`INSERT INTO ai_key_checks(user_id,attempts,next_at) VALUES($1,1,now()+interval '10 seconds')
    ON CONFLICT(user_id) DO UPDATE SET
      attempts=CASE WHEN ai_key_checks.window_start<now()-interval '1 hour' THEN 1 ELSE ai_key_checks.attempts+1 END,
      window_start=CASE WHEN ai_key_checks.window_start<now()-interval '1 hour' THEN now() ELSE ai_key_checks.window_start END,
      next_at=now()+interval '10 seconds'
    WHERE ai_key_checks.next_at<=now() AND (ai_key_checks.attempts<10 OR ai_key_checks.window_start<now()-interval '1 hour') RETURNING user_id`, [userId]);
  return rows.length > 0;
}

export async function validateAiKey(apiKey:string,model:string) {
  const ai = new GoogleGenAI({apiKey, httpOptions:{timeout:20_000,retryOptions:{attempts:1}}});
  // A small real request checks generation access, not merely whether the key can list models.
  // This consumes the client's quota and may be billable on their paid project.
  await ai.models.generateContent({model,contents:'Reply with OK.',config:{maxOutputTokens:32}});
}
