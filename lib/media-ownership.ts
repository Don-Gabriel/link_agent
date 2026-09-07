import { query } from './db';
export async function ownsMedia(agentId:string,ids:string[]) {
  if(!ids.length)return true;
  if(ids.some(id=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))return false;
  const owned=await query('SELECT id FROM media_assets WHERE agent_id=$1 AND id=ANY($2::uuid[])',[agentId,ids]);
  return owned.length===new Set(ids).size;
}
