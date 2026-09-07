import { existsSync, readFileSync } from 'node:fs';
export function localEnv() {
  if(!existsSync('.env.byline-local'))throw new Error('Run npm run local:setup first.');
  const parsed=Object.fromEntries(readFileSync('.env.byline-local','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
  if(!parsed.DATABASE_URL?.startsWith('postgresql://byline_local@127.0.0.1:55440/'))throw new Error('Local launcher requires the isolated local database.');
  return {...process.env,...parsed,
    BYLINE_TEST_MODE:'true',BYLINE_LOCAL_ONLY:'true',LINKEDIN_LIVE:'false',
    GEMINI_API_KEY:'',BREETH_API_KEY:'',LINKEDIN_CLIENT_ID:'',LINKEDIN_CLIENT_SECRET:'',
    GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',FCM_PROJECT_ID:'',FCM_CLIENT_EMAIL:'',FCM_PRIVATE_KEY:'',
    NEXT_DIST_DIR:'.next-byline',NEXT_TELEMETRY_DISABLED:'1'};
}
