import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

export async function garminInstaller(){
  const names=['api.py','core.py','health.py','accounts.py','user_garmin.py','coach.py','rewards.json','connector.py','requirements.txt','requirements-uv.txt'];
  const source=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(new URL('../backend/garmin/'+name,import.meta.url),'utf8')])));
  const packed=gzipSync(Buffer.from(JSON.stringify(source)),{level:9});
  const sha=createHash('sha256').update(packed).digest('hex');
  const template=await readFile(new URL('../backend/garmin/install.sh',import.meta.url),'utf8');
  return {text:template.replace('@TG_BUNDLE_SHA@',sha).replace('@TG_BUNDLE_B64@',packed.toString('base64')),sha,source};
}

export async function buildGarminInstaller(path){
  const bundle=await garminInstaller();
  await writeFile(path,bundle.text,{mode:0o644});
}
