/**
 * Login. POST a password, receive an httpOnly session cookie.
 *
 * The delay on failure is a deliberate brake on password guessing: this is a
 * single-password gate on an endpoint that can publish to a real profile, and
 * there is no account-lockout mechanism behind it.
 */
import { NextResponse } from "next/server";
import { authConfigured, createSession, passwordMatches, SESSION_COOKIE } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      { error: "auth_not_configured", detail: "Set APP_PASSWORD and APP_SECRET." },
      { status: 503 },
    );
  }

  let password = "";
  try {
    password = ((await request.json()) as { password?: string }).password ?? "";
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (!(await passwordMatches(password))) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }

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
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
