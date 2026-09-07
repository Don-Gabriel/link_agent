/** Browser-to-desktop signal only. Never forward codes or tokens to this URL. */
export function nativeReturnUri(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Exact loopback literal, unprivileged port and a random, app-owned path.
  // Reject URL normalization tricks, credentials, queries and fragments.
  const match = /^http:\/\/127\.0\.0\.1:([0-9]{4,5})\/byline-return\/[A-Za-z0-9_-]{43}$/.exec(value);
  if (!match) return null;
  const port = Number(match[1]);
  return port >= 1024 && port <= 65535 ? value : null;
}
