// Dedicated FCM sender for the hosted backend. Existing project bindings are preserved.
import {writeFileSync,existsSync} from 'node:fs';
import {googleOperatorFetch} from '../../scripts/google-operator.mjs';
const project='linkdin-43813',name='byline-cloud-push';
const email=`${name}@${project}.iam.gserviceaccount.com`;
const file=new URL('../../.byline-local/byline-cloud-fcm.json',import.meta.url);
async function api(url,method='GET',body) {
  const r=await googleOperatorFetch(url,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!r.ok)throw new Error(`Google setup failed: HTTP ${r.status}`);
  return r.json();
}
const base=`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts`;
const list=await api(base);
if(!(list.accounts??[]).some(a=>a.email===email))await api(base,'POST',{accountId:name,serviceAccount:{displayName:'ByLine Cloudflare notification sender',description:'Only sends FCM notifications for ByLine. Server credential; never included in the mobile app.'}});
const policyUrl=`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`;
const policy=await api(`${policyUrl}:getIamPolicy`,'POST',{options:{requestedPolicyVersion:3}});
const member=`serviceAccount:${email}`,role='roles/firebasecloudmessaging.admin';
let binding=policy.bindings?.find(b=>b.role===role&&!b.condition);
if(!binding?.members.includes(member)) {
  if(binding)binding.members.push(member);
  else {policy.bindings??=[];policy.bindings.push({role,members:[member]});}
  await api(`${policyUrl}:setIamPolicy`,'POST',{policy});
}
if(!existsSync(file)) {
  const key=await api(`${base}/${email}/keys`,'POST',{privateKeyType:'TYPE_GOOGLE_CREDENTIALS_FILE',keyAlgorithm:'KEY_ALG_RSA_2048'});
  writeFileSync(file,Buffer.from(key.privateKeyData,'base64'),{mode:0o600});
}
console.log(JSON.stringify({configured:true,project,serviceAccount:email,role,keyStoredLocally:true,notificationSent:false}));
