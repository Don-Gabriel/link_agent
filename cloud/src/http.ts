import { boundedText } from '../../lib/http-body';

export class HttpError extends Error {
  constructor(public status:number, message:string) { super(message); }
}
export function json(value:unknown, status=200):Response {
  return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
export async function body(request:Request):Promise<Record<string,unknown>> {
  try {
    const value:unknown=JSON.parse(await boundedText(request,64*1024));
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error();
    return value as Record<string,unknown>;
  } catch { throw new HttpError(400,'Invalid request body.'); }
}
export function text(value:unknown, max:number):string {
  if(typeof value!=='string'||value.length>max)throw new HttpError(400,'Invalid text value.');
  return value.trim();
}
export async function responseJson<T>(response:Response,maxBytes=128*1024):Promise<T> {
  if(!response.ok)throw new Error(`Provider returned HTTP ${response.status}`);
  return JSON.parse(await boundedText(response,maxBytes)) as T;
}
