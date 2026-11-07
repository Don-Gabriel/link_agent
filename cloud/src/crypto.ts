const encoder=new TextEncoder();
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export async function digest(value:string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));
}
async function signingKey(secret:string,usage:'sign'|'verify') {
  if(secret.length<32)throw new Error('Session secret is not configured');
  return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,[usage]);
}
export async function signSession(secret:string,userId:string,sessionId:string,expires:number) {
  const payload=`v2.${userId}.${sessionId}.${expires}`;
  const mac=await crypto.subtle.sign('HMAC',await signingKey(secret,'sign'),encoder.encode(payload));
  return `${payload}.${hex(new Uint8Array(mac))}`;
}
export async function verifySession(secret:string,value:string,now=Date.now()) {
  const p=value.split('.');
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(p.length!==5||p[0]!=='v2'||!uuid.test(p[1])||!uuid.test(p[2])||!/^\d{13}$/.test(p[3])||Number(p[3])<=now||!/^[0-9a-f]{64}$/.test(p[4]))return null;
  const mac=Uint8Array.from(p[4].match(/../g)!,b=>parseInt(b,16));
  const valid=await crypto.subtle.verify('HMAC',await signingKey(secret,'verify'),mac,encoder.encode(p.slice(0,4).join('.')));
  return valid?{userId:p[1],sessionId:p[2]}:null;
}
function unbase64(s:string):Uint8Array { return Uint8Array.from(atob(s),c=>c.charCodeAt(0)); }
function base64(b:Uint8Array):string {return btoa(Array.from(b,c=>String.fromCharCode(c)).join(''));}
async function encryptionKey(raw:string,usage:'encrypt'|'decrypt') {
  const value=raw.trim();
  const bytes=/^[0-9a-f]{64}$/i.test(value)?Uint8Array.from(value.match(/../g)!,h=>parseInt(h,16)):unbase64(value);
  if(bytes.length!==32)throw new Error('Token encryption key is not configured');
  return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,[usage]);
}
/** Same v1 layout as the original backend: nonce, GCM tag, ciphertext. */
export async function encryptToken(secret:string,plaintext:string) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(secret,'encrypt'),encoder.encode(plaintext)));
  const result=new Uint8Array(12+encrypted.length);
  result.set(iv); result.set(encrypted.subarray(-16),12); result.set(encrypted.subarray(0,-16),28);
  return 'v1:'+base64(result);
}
export async function decryptToken(secret:string,ciphertext:string) {
  if(!ciphertext.startsWith('v1:'))throw new Error('Unsupported token format');
  const bytes=unbase64(ciphertext.slice(3));
  if(bytes.length<=28)throw new Error('Invalid encrypted token');
  const data=new Uint8Array(bytes.length-12);
  data.set(bytes.subarray(28)); data.set(bytes.subarray(12,28),data.length-16);
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12)},await encryptionKey(secret,'decrypt'),data);
  return new TextDecoder().decode(plaintext);
}
