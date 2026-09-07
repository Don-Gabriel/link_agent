/**
 * The connected LinkedIn account: storage, decryption, and the expiry policy.
 *
 * The whole design is shaped by one fact: LinkedIn issues programmatic refresh
 * tokens only to approved Marketing Developer Platform partners. A standard
 * self-serve app gets a 60-day access token and nothing else. So this module
 * treats re-authorization as a normal scheduled event rather than an error —
 * it warns while the token still works, and pauses cleanly when it doesn't.
 */
import { query } from "./db";
import { decrypt, encrypt } from "./crypto";
import { refreshAccessToken, type MemberIdentity, type TokenGrant } from "./linkedin";

/** Start warning this many days before expiry — enough runway to act without urgency. */
export const REAUTH_WARNING_DAYS = 10;

interface AccountRow {
  agent_id: string;
  member_urn: string;
  member_name: string | null;
  member_picture: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  scopes: string | null;
  expires_at: Date;
  connected_at: Date;
  last_ok_at: Date | null;
  last_error: string | null;
}

export interface AccountStatus {
  connected: boolean;
  memberUrn?: string;
  memberName?: string;
  memberPicture?: string;
  expiresAt?: string;
  daysRemaining?: number;
  /** Token is still valid but inside the warning window. */
  expiringSoon?: boolean;
  /** Token is gone or expired: nothing can publish until the user reconnects. */
  needsReauth?: boolean;
  hasRefreshToken?: boolean;
  lastOkAt?: string;
  lastError?: string;
}

function daysUntil(date: Date): number {
  return Math.floor((date.getTime() - Date.now()) / 86_400_000);
}

export async function saveAccount(
  agentId: string,
  grant: TokenGrant,
  identity: MemberIdentity,
): Promise<void> {
  const expiresAt = new Date(Date.now() + grant.expiresInSeconds * 1000).toISOString();
  await query(
    `INSERT INTO linkedin_accounts
       (agent_id, member_urn, member_name, member_picture, access_token_enc, refresh_token_enc, scopes, expires_at, connected_at, last_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), NULL)
     ON CONFLICT (agent_id) DO UPDATE SET
       member_urn        = EXCLUDED.member_urn,
       member_name       = EXCLUDED.member_name,
       member_picture    = EXCLUDED.member_picture,
       access_token_enc  = EXCLUDED.access_token_enc,
       refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, linkedin_accounts.refresh_token_enc),
       scopes            = EXCLUDED.scopes,
       expires_at        = EXCLUDED.expires_at,
       connected_at      = now(),
       last_error        = NULL`,
    [
      agentId,
      identity.personUrn,
      identity.name ?? null,
      identity.picture ?? null,
      encrypt(grant.accessToken),
      grant.refreshToken ? encrypt(grant.refreshToken) : null,
      grant.scope ?? null,
      expiresAt,
    ],
  );
}

async function loadRow(agentId: string): Promise<AccountRow | null> {
  const rows = await query<AccountRow>("SELECT * FROM linkedin_accounts WHERE agent_id = $1", [
    agentId,
  ]);
  return rows[0] ?? null;
}

export async function getAccountStatus(agentId: string): Promise<AccountStatus> {
  const row = await loadRow(agentId);
  if (!row) return { connected: false };
  const days = daysUntil(row.expires_at);
  return {
    connected: true,
    memberUrn: row.member_urn,
    memberName: row.member_name ?? undefined,
    memberPicture: row.member_picture ?? undefined,
    expiresAt: row.expires_at.toISOString(),
    daysRemaining: Math.max(0, days),
    expiringSoon: days <= REAUTH_WARNING_DAYS && row.expires_at.getTime() > Date.now(),
    needsReauth: row.expires_at.getTime() <= Date.now(),
    hasRefreshToken: !!row.refresh_token_enc,
    lastOkAt: row.last_ok_at?.toISOString(),
    lastError: row.last_error ?? undefined,
  };
}

export type TokenLookup =
  | { ok: true; token: string; memberUrn: string }
  | { ok: false; reason: "not_connected" | "expired" | "decrypt_failed"; detail?: string };

/**
 * Fetch a usable access token, transparently refreshing first if a refresh
 * token exists (it will not, for a standard app — see the file header).
 *
 * Returning `expired` is a normal outcome, not an exception: callers pause and
 * surface the reconnect prompt instead of retrying.
 */
export async function getUsableToken(agentId: string): Promise<TokenLookup> {
  const row = await loadRow(agentId);
  if (!row) return { ok: false, reason: "not_connected" };

  let accessTokenEnc = row.access_token_enc;
  let expiresAt = row.expires_at;

  // Refresh a little early so a cycle never starts with a token about to die.
  const nearlyExpired = expiresAt.getTime() - Date.now() < 6 * 3_600_000;
  if (nearlyExpired && row.refresh_token_enc) {
    try {
      const refreshed = await refreshAccessToken(decrypt(row.refresh_token_enc));
      if (refreshed.ok) {
        accessTokenEnc = encrypt(refreshed.data.accessToken);
        expiresAt = new Date(Date.now() + refreshed.data.expiresInSeconds * 1000);
        await query(
          `UPDATE linkedin_accounts
              SET access_token_enc = $2,
                  refresh_token_enc = COALESCE($3, refresh_token_enc),
                  expires_at = $4
            WHERE agent_id = $1`,
          [
            agentId,
            accessTokenEnc,
            refreshed.data.refreshToken ? encrypt(refreshed.data.refreshToken) : null,
            expiresAt.toISOString(),
          ],
        );
        console.log(`[accounts] agent=${agentId} access token refreshed`);
      } else {
        console.warn(`[accounts] agent=${agentId} refresh failed: ${refreshed.reason}`);
      }
    } catch (err) {
      console.warn(`[accounts] agent=${agentId} refresh threw:`, String(err));
    }
  }

  if (expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  try {
    return { ok: true, token: decrypt(accessTokenEnc), memberUrn: row.member_urn };
  } catch (err) {
    // Almost always a rotated TOKEN_ENCRYPTION_KEY — the fix is to reconnect.
    return { ok: false, reason: "decrypt_failed", detail: String((err as Error)?.message ?? err) };
  }
}

export async function recordAccountOk(agentId: string): Promise<void> {
  await query(
    "UPDATE linkedin_accounts SET last_ok_at = now(), last_error = NULL WHERE agent_id = $1",
    [agentId],
  );
}

export async function recordAccountError(agentId: string, error: string): Promise<void> {
  await query("UPDATE linkedin_accounts SET last_error = $2 WHERE agent_id = $1", [
    agentId,
    error.slice(0, 500),
  ]);
}

/** Disconnect: the token is dropped entirely rather than left dormant in a row. */
export async function disconnectAccount(agentId: string): Promise<void> {
  await query("DELETE FROM linkedin_accounts WHERE agent_id = $1", [agentId]);
}
