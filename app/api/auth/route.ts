import { requestIdentity } from '../../../lib/request-agent';
import { query } from '../../../lib/db';
/**
 * Login. POST a password, receive an httpOnly session cookie.
 *
 * Guessing is bounded two ways. The 800ms delay on failure slows a sequential
 * attacker, and lib/ratelimit.ts counts failures per client in Postgres so a
 * PARALLEL one is stopped too — twenty simultaneous guesses all wait the same
 * 800ms once, which on its own costs an attacker almost nothing. Behind this
 * gate is an endpoint that publishes to a real profile.
 */
import { NextResponse } from "next/server";
import { authConfigured, createSession, passwordMatches, SESSION_COOKIE } from "../../../lib/auth";
import {
  checkLoginAllowed,
  clearLoginFailures,
  clientKey,
  MAX_ATTEMPTS,
  recordLoginFailure,
} from "../../../lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      { error: "auth_not_configured", detail: "Set APP_PASSWORD and APP_SECRET." },
      { status: 503 },
    );
  }

  const client = clientKey(request);
  const verdict = await checkLoginAllowed(client);
  if (!verdict.allowed) {
    // Checked BEFORE reading the body and before comparing anything, so a
    // blocked client cannot learn whether a password was close by timing.
    return NextResponse.json(
      {
        error: "too_many_attempts",
        detail: `${MAX_ATTEMPTS} failed attempts. Try again in ${verdict.retryAfterMinutes} minute${verdict.retryAfterMinutes === 1 ? "" : "s"}.`,
      },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterMinutes * 60) } },
    );
  }

  let password = "";
  try {
    password = ((await request.json()) as { password?: string }).password ?? "";
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (!(await passwordMatches(password))) {
    await recordLoginFailure(client);
    await new Promise((resolve) => setTimeout(resolve, 800));
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }

  // A correct password forgives this client's history, so a few fat-fingered
  // attempts never accumulate into a lockout during ordinary use.
  await clearLoginFailures(client);
  const session = await createSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}

/** Logout. */
export async function DELETE() {
  const identity = await requestIdentity();
  if (identity) await query('UPDATE byline_sessions SET revoked_at=now() WHERE id=$1', [identity.sessionId]);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
