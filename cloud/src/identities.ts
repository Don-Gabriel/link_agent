/** D1 transactions use a single atomic batch, never simulated BEGIN/COMMIT. */
export async function provisionIdentity(
  db: D1Database,
  identity: { provider: string; subject: string; name: string },
): Promise<{ userId: string; agentId: string }> {
  if (!['linkedin', 'google'].includes(identity.provider) || !identity.subject || identity.subject.length > 512) {
    throw new Error('Invalid verified identity');
  }
  const name = identity.name.trim().slice(0, 100) || 'ByLine author';
  const userId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const persona = JSON.stringify({
    input: { name, domain: 'Your selected topics' },
    identity: { voice: 'Clear and thoughtful. Do not invent personal experiences or opinions.', interests: [], opinions: [], skeptical_of: [] },
    generator: 'fallback',
  });
  const byIdentity = 'SELECT id FROM byline_users WHERE provider=? AND subject=?';
  const args = [identity.provider, identity.subject];
  const result = await db.batch([
    db.prepare(`INSERT INTO byline_users(id,provider,subject,name) VALUES(?,?,?,?)
      ON CONFLICT(provider,subject) DO UPDATE SET name=excluded.name`).bind(userId, ...args, name),
    db.prepare(`INSERT INTO agents(id,name,domain,persona_json,persona_hash,owner_id,paused,timezone,post_time_local,style_json,categories_json)
      SELECT ?,?,'Your selected topics',?,'byline:' || id,id,1,'UTC','09:00','{"signature":null}','["emerging-tech"]'
      FROM byline_users WHERE provider=? AND subject=?
      ON CONFLICT(owner_id) WHERE owner_id IS NOT NULL DO NOTHING`).bind(agentId, name, persona, ...args),
    db.prepare(`INSERT INTO onboarding(user_id) ${byIdentity} ON CONFLICT DO NOTHING`).bind(...args),
    db.prepare(`SELECT u.id AS userId,a.id AS agentId FROM byline_users u JOIN agents a ON a.owner_id=u.id
      WHERE u.provider=? AND u.subject=?`).bind(...args),
  ]);
  const saved = result[3].results[0] as { userId: string; agentId: string } | undefined;
  if (!saved) throw new Error('Identity provisioning failed');
  return saved;
}

/** Session ownership is resolved server-side; callers cannot select another agent. */
export async function sessionOwner(db: D1Database, userId: string, sessionId: string, now = new Date()) {
  return db.prepare(`SELECT u.id AS userId,a.id AS agentId,u.name FROM byline_sessions s
    JOIN byline_users u ON u.id=s.user_id JOIN agents a ON a.owner_id=u.id
    WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>?`)
    .bind(sessionId, userId, now.toISOString()).first<{ userId: string; agentId: string; name: string }>();
}
