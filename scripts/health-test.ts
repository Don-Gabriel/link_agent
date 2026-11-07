import assert from 'node:assert/strict';
import { GET } from '../app/api/health/route';

// This process never opens a database connection. Exercise the public route
// with a successful, failing and absent database, including error redaction.
async function main() {
  const state = (globalThis as unknown as {
    __linkdinDb: { pool: unknown };
  }).__linkdinDb;
  process.env.DATABASE_URL = 'postgres://unused.invalid/test';
  state.pool = { query: async () => ({ rows: [{ '?column?': 1 }] }) };
  let response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await response.json()).ok, true);

  state.pool = { query: async () => { throw new Error('private-password-and-host'); } };
  response = await GET();
  assert.equal(response.status, 503);
  const failed = await response.text();
  assert.equal(JSON.parse(failed).ok, false);
  assert.equal(JSON.parse(failed).db, 'unavailable');
  assert.equal(failed.includes('private-password-and-host'), false);

  delete process.env.DATABASE_URL;
  response = await GET();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).db, 'unconfigured');
  console.log('Health readiness: healthy, outage redaction and unconfigured checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
