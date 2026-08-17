/**
 * OAuth callback: verify state, exchange the code, resolve the person URN,
 * store the encrypted token.
 *
 * Every exit is a redirect back to the dashboard with an error code rather
 * than raw JSON — this URL is opened as a top-level browser navigation, so
 * whatever it returns is what the user reads.
 */
import { NextResponse } from "next/server";
import { saveAccount } from "../../../../lib/accounts";
import { query } from "../../../../lib/db";
import { exchangeCode, getMemberIdentity } from "../../../../lib/linkedin";
import { redirectUriFor } from "../redirect-uri";

export const dynamic = "force-dynamic";

function back(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL("/", request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // LinkedIn reports user-side refusal here rather than by omitting the code.
  const denied = url.searchParams.get("error");
  if (denied) {
    return back(request, {
      error: "linkedin_denied",
      detail: url.searchParams.get("error_description") ?? denied,
    });
  }
  if (!code || !state) return back(request, { error: "missing_code_or_state" });

  // Single-use state: the DELETE ... RETURNING both validates and consumes it,
  // so a replayed callback finds nothing and is rejected.
  const claimed = await query<{ agent_id: string }>(
    "DELETE FROM oauth_states WHERE state = $1 AND created_at > now() - interval '1 hour' RETURNING agent_id",
    [state],
  );
  if (claimed.length === 0) return back(request, { error: "invalid_or_expired_state" });
  const agentId = claimed[0].agent_id;

  const grant = await exchangeCode(code, redirectUriFor(request));
  if (!grant.ok) return back(request, { error: "token_exchange_failed", detail: grant.reason });

  const identity = await getMemberIdentity(grant.data.accessToken);
  if (!identity.ok) return back(request, { error: "identity_failed", detail: identity.reason });

  try {
    await saveAccount(agentId, grant.data, identity.data);
  } catch (err) {
    // Almost always a missing or malformed TOKEN_ENCRYPTION_KEY.
    return back(request, {
      error: "store_failed",
      detail: String((err as Error)?.message ?? err).slice(0, 160),
    });
  }

  console.log(
    `[linkedin] agent=${agentId} connected as ${identity.data.personUrn}` +
      `${grant.data.refreshToken ? " (with refresh token)" : " (no refresh token — 60-day re-auth)"}`,
  );
  return back(request, { connected: "1" });
}
