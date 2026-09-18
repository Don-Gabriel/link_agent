/**
 * Dashboard authentication — a single shared password, because there is
 * exactly one user.
 *
 * This is not over-engineering: the dashboard can publish to a real LinkedIn
 * profile, and a Vercel URL is guessable and crawlable. Without a gate, the
 * "publish this draft" endpoint is a public API for posting as you.
 *
 * The session cookie is `<expiryMs>.<hmac>` signed with APP_SECRET. Web Crypto
 * is used rather than node:crypto so the exact same code runs in middleware
 * (edge runtime) and in route handlers (node runtime) — one implementation,
 * one place to get it wrong.
 */

const encoder = new TextEncoder();

export const SESSION_COOKIE = "lc_session";
const SESSION_DAYS = 30;

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length-independent comparison so a wrong-length token cannot be distinguished by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export function authConfigured(): boolean {
  return process.env.BYLINE_ALLOW_LEGACY_AUTH !== 'false' && !!process.env.APP_PASSWORD && !!process.env.APP_SECRET;
}

export async function createSession(): Promise<{ value: string; maxAge: number }> {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is not set");
  const maxAge = SESSION_DAYS * 86_400;
  const expiry = String(Date.now() + maxAge * 1000);
  return { value: `${expiry}.${await sign(expiry, secret)}`, maxAge };
}

export async function verifySession(cookie: string | undefined): Promise<boolean> {
  const secret = process.env.APP_SECRET;
  if (!secret || !cookie) return false;
  if (cookie.startsWith('v2.')) return (await sessionIdentity(cookie)) !== null;
  if (process.env.BYLINE_ALLOW_LEGACY_AUTH === 'false') return false;
  if (cookie.split('.').length !== 2) return false;
  const [expiry, mac] = cookie.split(".");
  if (!expiry || !mac) return false;
  if (!Number.isFinite(Number(expiry)) || Number(expiry) < Date.now()) return false;
  return timingSafeEqual(mac, await sign(expiry, secret));
}

/** Native sessions carry identity, never a client-selected agent id. */
export async function createUserSession(userId: string, sessionId: string) {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error('APP_SECRET is not set');
  const maxAge = SESSION_DAYS * 86400;
  const payload = `v2.${userId}.${sessionId}.${Date.now() + maxAge * 1000}`;
  return { value: `${payload}.${await sign(payload, secret)}`, maxAge };
}

export async function sessionIdentity(value: string | undefined): Promise<{ userId: string; sessionId: string } | null> {
  if (!value || !process.env.APP_SECRET) return null;
  const parts = value.split('.');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (parts.length !== 5 || parts[0] !== 'v2' || !uuid.test(parts[1]) || !uuid.test(parts[2]) ||
      !Number.isFinite(Number(parts[3])) || Number(parts[3]) <= Date.now()) return null;
  if (!timingSafeEqual(parts[4], await sign(parts.slice(0, 4).join('.'), process.env.APP_SECRET))) return null;
  return { userId: parts[1], sessionId: parts[2] };
}

export async function passwordMatches(candidate: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  // Compare digests so the comparison is constant-length regardless of input.
  const secret = process.env.APP_SECRET ?? expected;
  const [a, b] = await Promise.all([sign(candidate, secret), sign(expected, secret)]);
  return timingSafeEqual(a, b);
}
