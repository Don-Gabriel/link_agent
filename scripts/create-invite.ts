import {randomBytes,createHash} from 'node:crypto';
import {query,getPool,ensureSchema} from '../lib/db';
import {loadEnvConfig} from '@next/env';
loadEnvConfig(process.cwd());

async function main() {
  if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL for the intended installation.');
  await ensureSchema();
  const code=randomBytes(24).toString('base64url');
  await query("INSERT INTO byline_invites(code_hash,expires_at) VALUES($1,now()+interval '7 days')",[createHash('sha256').update(code).digest('hex')]);
  console.log('One-use invitation, valid for 7 days. Share privately with one client:');
  console.log(code);
}
main().catch(()=>{console.error('Could not create an invitation. Check the database and migration configuration.');process.exitCode=1;})
  .finally(()=>getPool()?.end());
