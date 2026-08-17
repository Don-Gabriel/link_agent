/**
 * The redirect URI must be byte-identical between the authorize call, the
 * token exchange, and the value registered in the LinkedIn app — a mismatch
 * is the single most common cause of a failed connection.
 *
 * So it is computed in exactly one place. LINKEDIN_REDIRECT_URI wins when set
 * (the only reliable option behind proxies and preview deployments); otherwise
 * it is derived from the incoming request for local development.
 */
export function redirectUriFor(request: Request): string {
  const configured = process.env.LINKEDIN_REDIRECT_URI;
  if (configured) return configured;
  return new URL("/api/linkedin/callback", request.url).toString();
}
