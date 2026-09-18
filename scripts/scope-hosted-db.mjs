import {writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {readEnvFile} from './live-env.mjs';
const file='.byline-release/render.env';
const env=readEnvFile(file);
const target=new URL(env.DATABASE_URL);
if(target.pathname!=='/byline_public'||!target.hostname.endsWith('.neon.tech'))throw new Error('Expected the separate client database.');
if(target.username==='byline_client_service') {
  console.log('Hosted environment already uses the dedicated database role.');
} else {
  const original=readEnvFile('.env');
  const admin=new pg.Client({connectionString:original.DATABASE_URL});
  const password=randomBytes(32).toString('hex');
  await admin.connect();
  try {
    await admin.query('BEGIN');
    if((await admin.query("SELECT 1 FROM pg_roles WHERE rolname='byline_client_service'")).rowCount)
      throw new Error('The service role already exists. Restore its saved credentials rather than rotating them.');
    // Password is generated hex, never external input; no secrets are logged.
    await admin.query(`CREATE ROLE byline_client_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    await admin.query('GRANT byline_client_service TO CURRENT_USER');
    await admin.query('ALTER DATABASE byline_public OWNER TO byline_client_service');
    await admin.query('REVOKE byline_client_service FROM CURRENT_USER');
    await admin.query('COMMIT');
    target.username='byline_client_service';target.password=password;
    target.searchParams.set('sslmode','verify-full');
    env.DATABASE_URL=target.href;
    writeFileSync(file,Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
    console.log('Hosted database access now uses a dedicated non-admin role.');
  } catch(error) {await admin.query('ROLLBACK');throw error;}
  finally {await admin.end();}
}
