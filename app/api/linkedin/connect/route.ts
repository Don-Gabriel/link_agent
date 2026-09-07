/**
 * Start the OAuth round trip. Mints a single-use state value, stores it, and
 * redirects to LinkedIn's consent screen.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getRequestAgent } from "../../../../lib/request-agent";
import { query } from "../../../../lib/db";
import { authorizeUrl } from "../../../../lib/linkedin";
import { redirectUriFor } from "../redirect-uri";
import { nativeReturnUri } from '../../../../lib/native-return';

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const agent = await getRequestAgent();
  // `?json=1` returns the consent URL instead of redirecting to it.
  //
  // The browser wants a 302 — it is mid-navigation. A phone cannot use one: the
  // Flutter client would have to follow the redirect itself, inside its own HTTP
  // stack, where LinkedIn's consent page is unusable and the session cookie it
  // needs afterwards would never reach the system browser. So the app asks for
  // the URL and hands it to the real browser instead.
  const wantsJson = new URL(request.url).searchParams.get("json") === "1";

  const fail = (code: string) =>
    wantsJson
      ? NextResponse.json({ error: code }, { status: 400 })
      : NextResponse.redirect(new URL(`/?error=${code}`, request.url));

  if (!agent) return fail("not_initialized");

  const requestedReturn = new URL(request.url).searchParams.get('returnUri');
  const returnUri = nativeReturnUri(requestedReturn);
  if (requestedReturn && !returnUri) return fail('invalid_return_uri');
  const state = `${wantsJson ? 'app-' : ''}${randomUUID()}`;
  await query("INSERT INTO oauth_states (state, agent_id, native, return_uri) VALUES ($1, $2, $3, $4)", [state, agent.agentId, wantsJson, returnUri]);
  // Housekeeping: abandoned round trips would otherwise accumulate forever.
  await query("DELETE FROM oauth_states WHERE created_at < now() - interval '1 hour'");

  const url = authorizeUrl(state, redirectUriFor(request));
  if (!url) return fail("missing_client_id");
  return wantsJson ? NextResponse.json({ url }) : NextResponse.redirect(url);
}
