/**
 * Start the OAuth round trip. Mints a single-use state value, stores it, and
 * redirects to LinkedIn's consent screen.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getPrimaryAgent } from "../../../../lib/agents";
import { query } from "../../../../lib/db";
import { authorizeUrl } from "../../../../lib/linkedin";
import { redirectUriFor } from "../redirect-uri";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const agent = await getPrimaryAgent();
  if (!agent) return NextResponse.redirect(new URL("/?error=not_initialized", request.url));

  const state = randomUUID();
  await query("INSERT INTO oauth_states (state, agent_id) VALUES ($1, $2)", [state, agent.agentId]);
  // Housekeeping: abandoned round trips would otherwise accumulate forever.
  await query("DELETE FROM oauth_states WHERE created_at < now() - interval '1 hour'");

  const url = authorizeUrl(state, redirectUriFor(request));
  if (!url) return NextResponse.redirect(new URL("/?error=missing_client_id", request.url));
  return NextResponse.redirect(url);
}
