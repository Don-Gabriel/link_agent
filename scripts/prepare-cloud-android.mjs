// Prepares local build configuration only. Never connects to or installs on a phone.
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const origin=process.argv[2];
if(!origin||!/^https:\/\/[a-z0-9.-]+$/.test(origin))throw new Error('Supply the approved HTTPS backend origin');
const config=JSON.parse(readFileSync('.byline-local/firebase-live-google-services.json','utf8'));
const client=config.client.find(c=>c.client_info.android_client_info.package_name==='com.linkdin.byline');
if(!client||config.project_info.project_id!=='linkdin-43813')throw new Error('Firebase configuration does not match ByLine');
const keystore=resolve('.byline-local/byline-release.p12'),properties='mobile/android/key.properties';
if(!existsSync(keystore)&&!existsSync(properties)) {
  const password=randomBytes(32).toString('hex');
  execFileSync('keytool',['-genkeypair','-keystore',keystore,'-storetype','PKCS12','-alias','byline','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=ByLine, O=ByLine','-storepass:env','BYLINE_KEY_PASSWORD','-keypass:env','BYLINE_KEY_PASSWORD','-noprompt'],
    {env:{...process.env,BYLINE_KEY_PASSWORD:password},stdio:'pipe'});
  writeFileSync(properties,`storeFile=${keystore.replaceAll('\\','/')}\nstorePassword=${password}\nkeyPassword=${password}\nkeyAlias=byline\n`,{mode:0o600});
}
if(!existsSync(keystore)||!existsSync(properties))throw new Error('Signing configuration is incomplete; recover it instead of generating a different key');
writeFileSync('.byline-local/cloud-dart-defines.json',JSON.stringify({BYLINE_APP_VARIANT:'cloud',BYLINE_API_URL:origin,
  FIREBASE_API_KEY:client.api_key[0].current_key,FIREBASE_APP_ID:client.client_info.mobilesdk_app_id,FIREBASE_PROJECT_ID:config.project_info.project_id,FIREBASE_SENDER_ID:config.project_info.project_number},null,2));
console.log(JSON.stringify({prepared:true,origin,signing:'private-release-key',phoneTouched:false}));
