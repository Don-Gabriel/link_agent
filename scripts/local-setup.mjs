import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const bin=process.env.PG_BIN ?? (process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin':'');
const exe=n=>join(bin,n+(process.platform==='win32'?'.exe':''));
const root=resolve('.byline-local');const data=join(root,'postgres');
mkdirSync(root,{recursive:true});
function run(n,args){const r=spawnSync(exe(n),args,{encoding:'utf8',windowsHide:true,stdio:n==='pg_ctl'?'ignore':'pipe'});if(r.status!==0)throw new Error(`${n} failed: ${r.stderr??r.error}`);}
if(!existsSync(join(data,'PG_VERSION')))run('initdb',['-D',data,'-U','byline_local','-A','trust','--encoding=UTF8','--no-locale']);
if(spawnSync(exe('pg_ctl'),['-D',data,'status'],{windowsHide:true}).status!==0)run('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o','-h 127.0.0.1 -p 55440','-w','start']);
const args=['-h','127.0.0.1','-p','55440','-U','byline_local'];
const check=spawnSync(exe('psql'),[...args,'-d','postgres','-Atc',"SELECT 1 FROM pg_database WHERE datname='byline_local'"],{encoding:'utf8',windowsHide:true});
if(check.status!==0)throw new Error('Cannot connect to isolated PostgreSQL.');
if(check.stdout.trim()!=='1')run('createdb',[...args,'byline_local']);
if(!existsSync('.env.byline-local'))writeFileSync('.env.byline-local',[
  '# Generated local-only test settings. Never commit this file.',
  'DATABASE_URL=postgresql://byline_local@127.0.0.1:55440/byline_local',
  `APP_SECRET=${randomBytes(32).toString('hex')}`,`APP_PASSWORD=${randomBytes(24).toString('hex')}`,
  `TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,`CRON_SECRET=${randomBytes(24).toString('hex')}`,
  'BYLINE_PUBLIC_URL=http://localhost:3100','PORT=3100',''].join('\n'),{mode:0o600});
console.log('ByLine isolated local database is ready. No provider keys or paid services are used.');
console.log('Next: npm run local:dev. Your existing database and .env files are unchanged.');
