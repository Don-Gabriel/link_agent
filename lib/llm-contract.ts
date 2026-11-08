export interface CompleteArgs {
  system: string;
  user: string;
  /** Smaller prompt variant for low-TPM models (Gemma). Optional. */
  compactUser?: string;
  jsonMode?: boolean;
  /** Optional constrained-output schema for compatible self-hosted servers. */
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
}

export type CompleteResult =
  | { ok: true; text: string; model: string; usage?: { inputTokens: number | null; outputTokens: number | null; neurons?: number } }
  | { ok: false; reason: string; retryAfterMs?: number };


export type Completion = (args: CompleteArgs) => Promise<CompleteResult>;

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
