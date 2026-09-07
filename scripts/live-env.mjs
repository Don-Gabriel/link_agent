import { readFileSync, existsSync } from 'node:fs';
export function readEnvFile(name) {
  if(!existsSync(name))throw new Error(`Missing ${name}. Run npm run live:setup first.`);
  return Object.fromEntries(readFileSync(name,'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
}
export function liveEnv() {
  const configured=readEnvFile('.env.byline-live');
  if(configured.DATABASE_URL!=='postgresql://byline_local@127.0.0.1:55440/byline_live')throw new Error('Live development requires the separate local ByLine database.');
  return {...process.env,...configured,BYLINE_TEST_MODE:'false',BYLINE_LOCAL_ONLY:'false',NEXT_DIST_DIR:'.next-byline-live',NEXT_TELEMETRY_DISABLED:'1',BREETH_API_KEY:''};
}
