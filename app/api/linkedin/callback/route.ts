import { completeNativeAuth } from '../../../../lib/native-auth';
import { nativeCallbackPage } from '../../../../lib/native-callback';
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

  const flow = state ? await completeNativeAuth(state, code, url.searchParams.has('error')) : null;
  if (flow) return nativeCallbackPage(flow.ok, flow.returnUri);
  // Native callbacks must never fall through to the legacy web dashboard.
  if (state?.startsWith('native-')) return nativeCallbackPage(false);


  if (!state) return nativeCallbackPage(false);
  // Consume state even on cancellation and keep its native return destination.
  const claimed = await query<{ agent_id: string; native: boolean; return_uri: string | null }>(
    "DELETE FROM oauth_states WHERE state = $1 AND created_at > now() - interval '1 hour' RETURNING agent_id, native, return_uri",
    [state],
  );
  if (claimed.length === 0) return nativeCallbackPage(false);
  const finish = (ok: boolean, params: Record<string, string>) => claimed[0].native
    ? nativeCallbackPage(ok, claimed[0].return_uri) : back(request, params);
  if (url.searchParams.has('error')) return finish(false, { error: 'linkedin_denied' });
  if (!code) return finish(false, { error: 'missing_code_or_state' });
  const agentId = claimed[0].agent_id;

  const grant = await exchangeCode(code, redirectUriFor(request));
  if (!grant.ok) return finish(false, { error: "token_exchange_failed", detail: grant.reason });

  const identity = await getMemberIdentity(grant.data.accessToken);
  if (!identity.ok) return finish(false, { error: "identity_failed", detail: identity.reason });

  try {
    await saveAccount(agentId, grant.data, identity.data);
  } catch (err) {
    // Almost always a missing or malformed TOKEN_ENCRYPTION_KEY.
    return finish(false, {
      error: "store_failed",
      detail: String((err as Error)?.message ?? err).slice(0, 160),
    });
  }

  console.log(
    `[linkedin] agent=${agentId} connected as ${identity.data.personUrn}` +
      `${grant.data.refreshToken ? " (with refresh token)" : " (no refresh token — 60-day re-auth)"}`,
  );
  return finish(true, { connected: "1" });
}
