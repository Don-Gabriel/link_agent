import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
process.env.BYLINE_REQUIRE_MIGRATIONS='false';
async function main(){
  const {ensureSchema,getPool}=await import('../lib/db');
  if(!await ensureSchema())throw new Error('Configure DATABASE_URL before migrating.');
  await getPool()?.end();
  console.log('ByLine schema migration completed.');
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1;});
