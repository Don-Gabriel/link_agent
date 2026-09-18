import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=resolve('.byline-release/private');
const properties=resolve('mobile/android/key.properties');
const store=join(root,'byline-release.jks');
if(existsSync(properties)) {
  console.log('Existing private Android signing configuration will be used.');
} else {
  if(existsSync(store))throw new Error('Signing key already exists. Restore its original key.properties; never replace it.');
  mkdirSync(root,{recursive:true});
  const password=randomBytes(32).toString('hex');
  const tool=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'keytool.exe':'keytool'):'keytool';
  const result=spawnSync(tool,['-genkeypair','-keystore',store,'-storetype','JKS','-alias','byline',
    '-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=ByLine',
    '-storepass:env','BYLINE_SIGNING_PASSWORD','-keypass:env','BYLINE_SIGNING_PASSWORD'],
    {env:{...process.env,BYLINE_SIGNING_PASSWORD:password},stdio:'pipe',windowsHide:true});
  if(result.status!==0)throw new Error('Android key generation failed. Check JAVA_HOME; secrets were not printed.');
  writeFileSync(properties,`storeFile=${store.replaceAll('\\','/')}\nstorePassword=${password}\nkeyAlias=byline\nkeyPassword=${password}\n`,{flag:'wx',mode:0o600});
  console.log('Created the private Android release signing key. Back up .byline-release/private and mobile/android/key.properties securely.');
}
