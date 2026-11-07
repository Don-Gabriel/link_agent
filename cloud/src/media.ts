import { initializeImageUpload,uploadImageBytes } from '../../lib/linkedin';
import { usableToken } from './publish';
import { HttpError,json } from './http';
import type { Owner } from './auth';
import type { AppEnv } from './env';
export async function mediaRoute(request:Request,env:AppEnv,owner:Owner) {
  const max=4*1024*1024+65536;
  if(!request.body)throw new HttpError(400,'Choose an image.');
  const reader=request.body.getReader(),chunks:Uint8Array[]=[],headers=new Headers(request.headers);let count=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>max){await reader.cancel();throw new HttpError(413,'Use an image smaller than 4 MB.');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(count);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const form=await new Response(bytes,{headers}).formData(),file=form.get('file');
  if(!(file instanceof File)||file.size>4*1024*1024||!['image/jpeg','image/png','image/gif'].includes(file.type))throw new HttpError(400,'Choose a JPG, PNG or GIF smaller than 4 MB.');
  const token=await usableToken(env,owner.agentId),registered=await initializeImageUpload(token.token,token.memberUrn);
  if(!registered.ok)throw new HttpError(502,'LinkedIn could not start the image upload.');
  const altText=String(form.get('altText')??'').slice(0,300),id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO media_assets(id,agent_id,linkedin_urn,upload_url,alt_text,filename) VALUES(?,?,?,?,?,?)').bind(id,owner.agentId,registered.data.imageUrn,registered.data.uploadUrl,altText,file.name.slice(0,255)).run();
  const uploaded=await uploadImageBytes(token.token,registered.data.uploadUrl,await file.arrayBuffer(),file.type);
  await env.DB.prepare('UPDATE media_assets SET status=? WHERE id=? AND agent_id=?').bind(uploaded.ok?'uploaded':'failed',id,owner.agentId).run();
  if(!uploaded.ok)throw new HttpError(502,'The image upload did not finish. Please try again.');
  return json({ok:true,id,imageUrn:registered.data.imageUrn,altText});
}
