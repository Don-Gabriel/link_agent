import { readFileSync } from 'node:fs';
import { googleOperatorFetch } from './google-operator.mjs';
const lines=readFileSync('.env','utf8').split(/\r?\n/);
const settings=Object.fromEntries(lines.filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
async function get(url){const r=await googleOperatorFetch(url);const d=await r.json();if(!r.ok){console.log('Google configuration read failed:',r.status,d.error?.status);return null;}return d;}
const key=await get(`https://apikeys.googleapis.com/v2/keys:lookupKey?keyString=${encodeURIComponent(settings.GEMINI_API_KEY)}`);
const project=key?.parent?.split('/')[1];
if(project){console.log('Gemini project:',project);const billing=await get(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`);console.log('Gemini billing enabled:',billing?.billingEnabled??'unknown');}
const firebase=JSON.parse(readFileSync('mobile/android/app/google-services.json','utf8'));
const id=firebase.project_info.project_id;
const billing=await get(`https://cloudbilling.googleapis.com/v1/projects/${id}/billingInfo`);console.log('Firebase billing enabled:',billing?.billingEnabled??'unknown');
console.log('Android OAuth client types:',firebase.client.flatMap(c=>(c.oauth_client??[]).map(x=>x.client_type)));
