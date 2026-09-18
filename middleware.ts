/**
 * Fail-closed gate for every API route.
 *
 * Deliberately a middleware rather than a check inside each handler: a new
 * route added six months from now is protected by default, and forgetting the
 * check is not one of the available mistakes. The exceptions below are
 * explicit and each carries its own authentication.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/auth";

const PUBLIC_PATHS = new Set([
  "/api/health", // liveness/keep-alive: no data, always 200
  "/api/auth", // the login endpoint itself
  "/api/native-auth",
  "/api/native-auth/callback",
  "/api/linkedin/callback", // single-use server-side OAuth state authenticates this navigation
  "/api/cron/tick", // authenticated by the X-Cron-Secret header instead
  "/api/cron/wake", // same secret; acknowledges before a long tick
  // Same X-Cron-Secret, same reason: it is called by a machine that has no
  // session and never will. Both answer 404 rather than 401 on a bad secret,
  // so neither confirms it exists to anyone without it.
  "/api/watchdog",
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/") || PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const bearer = request.headers.get('authorization');
  if (await verifySession(bearer?.startsWith('Bearer ') ? bearer.slice(7) : request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  // The OAuth callback is a top-level browser navigation, so send a readable
  // page rather than a bare JSON 401 the user would see as raw text.
  if (pathname.startsWith("/api/linkedin/callback")) {
    return NextResponse.redirect(new URL("/?error=session_expired", request.url));
  }
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export const config = {
  matcher: "/api/:path*",
};
