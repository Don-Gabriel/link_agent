import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {googleOperatorFetch} from './google-operator.mjs';
const project=process.argv[2];
if(!project||!/^[-a-z0-9]+$/.test(project))throw new Error('Supply the existing Firebase project ID.');
const folder='.byline-release/private';
const keyFile=`${folder}/firebase-push.json`;
const envFile='.byline-release/render.env';
if(!existsSync(envFile))throw new Error('Prepare the Render environment first.');
async function call(url,method='GET',body) {
  const response=await googleOperatorFetch(url,{method,...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok)throw new Error(`Google IAM operation failed (${response.status}: ${data.error?.status??'unknown'}).`);
  return data;
}
const email=`byline-render-push@${project}.iam.gserviceaccount.com`;
const service=`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts`;
const list=await call(service);
if(!list.accounts?.some(a=>a.email===email))await call(service,'POST',{accountId:'byline-render-push',serviceAccount:{displayName:'ByLine hosted push sender'}});
// A custom role avoids granting unrelated Firebase administration rights.
const roleName=`projects/${project}/roles/bylinePushSender`;
const roles=await call(`https://iam.googleapis.com/v1/projects/${project}/roles`);
let role=roles.roles?.find(r=>r.name===roleName);
if(!role)role=await call(`https://iam.googleapis.com/v1/projects/${project}/roles`,'POST',{
  roleId:'bylinePushSender',role:{title:'ByLine push sender',description:'Send ByLine device reminders only.',includedPermissions:['cloudmessaging.messages.create'],stage:'GA'},
});
else {
  const detail=await call(`https://iam.googleapis.com/v1/${roleName}`);
  if(detail.includedPermissions?.length!==1||detail.includedPermissions[0]!=='cloudmessaging.messages.create')throw new Error('Existing role has unexpected permissions; review it manually.');
}
const policyUrl=`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`;
const policy=await call(`${policyUrl}:getIamPolicy`,'POST',{options:{requestedPolicyVersion:3}});
policy.bindings??=[];
let binding=policy.bindings.find(b=>b.role===roleName&&!b.condition);
if(!binding){binding={role:roleName,members:[]};policy.bindings.push(binding);}
if(!binding.members.includes(`serviceAccount:${email}`)) {
  binding.members.push(`serviceAccount:${email}`);
  await call(`${policyUrl}:setIamPolicy`,'POST',{policy});
}
mkdirSync(folder,{recursive:true});
if(!existsSync(keyFile)) {
  const generated=await call(`${service}/${email}/keys`,'POST',{privateKeyType:'TYPE_GOOGLE_CREDENTIALS_FILE',keyAlgorithm:'KEY_ALG_RSA_2048'});
  writeFileSync(keyFile,Buffer.from(generated.privateKeyData,'base64'),{flag:'wx',mode:0o600});
}
const key=JSON.parse(readFileSync(keyFile,'utf8'));
if(key.client_email!==email)throw new Error('Private key belongs to a different service account.');
const lines=readFileSync(envFile,'utf8').split(/\r?\n/).filter(l=>l&&!/^FCM_/.test(l));
lines.push(`FCM_PROJECT_ID=${project}`,`FCM_CLIENT_EMAIL=${email}`,`FCM_PRIVATE_KEY=${key.private_key.replaceAll('\n','\\n')}`);
writeFileSync(envFile,lines.join('\n')+'\n',{mode:0o600});
console.log('Dedicated messaging-only credentials prepared for Render. Private key values were not printed.');
