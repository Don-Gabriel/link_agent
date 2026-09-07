import { headers } from 'next/headers';
import { sessionIdentity, verifySession } from './auth';
import { query } from './db';
import { getAgentSettings, getPrimaryAgent } from './agents';

export function credential(h: Headers): string | undefined {
  const bearer = h.get('authorization');
  if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
  return h.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith('lc_session='))?.slice(11);
}

export async function requestIdentity() {
  const token = credential(await headers());
  const identity = await sessionIdentity(token);
  if (!identity) return null;
  const rows = await query<{ id: string; name: string }>(
    `SELECT u.id, u.name FROM byline_users u JOIN byline_sessions s ON s.user_id=u.id
      WHERE u.id=$1 AND s.id=$2 AND s.expires_at>now() AND s.revoked_at IS NULL`,
    [identity.userId, identity.sessionId]);
  return rows[0] ? { ...identity, name: rows[0].name } : null;
}

/** Legacy password sessions retain the old installation. Native sessions never fall back to it. */
export async function getRequestAgent() {
  const token = credential(await headers());
  if (token?.startsWith('v2.')) {
    const identity = await requestIdentity();
    if (!identity) return null;
    const rows = await query<{ id: string }>('SELECT id FROM agents WHERE owner_id=$1 AND active', [identity.userId]);
    return rows[0] ? getAgentSettings(rows[0].id) : null;
  }
  return await verifySession(token) ? getPrimaryAgent() : null;
}
