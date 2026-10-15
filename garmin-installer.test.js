import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {garminInstaller} from './scripts/build-garmin-installer.mjs';

test('standalone installer verifies and extracts only its pinned sources, rejecting corruption and symlinks',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'tg-installer-'));
 try{
  const {text,sha,source}=await garminInstaller();
  assert.equal(spawnSync('bash',['-n'],{input:text,encoding:'utf8'}).status,0);
  const code=text.split("<<'PY_SOURCE'\n")[1].split('\nPY_SOURCE')[0];
  const run=(code,target,digest)=>spawnSync('python3',['-c',code,target,digest],{encoding:'utf8'});
  const dest=join(temp,'app');assert.equal(run(code,dest,sha).status,0);
  for(const [name,content]of Object.entries(source))assert.equal(await readFile(join(dest,name),'utf8'),content);
  assert.equal(run(code,dest,sha).status,0,'repeated source extraction remains valid');
  assert.notEqual(run(code,join(temp,'corrupted'),'0'.repeat(64)).status,0,'tampered checksum fails');
  const outside=join(temp,'untouched');await writeFile(outside,'untouched');await rm(join(dest,'api.py'));await symlink(outside,join(dest,'api.py'));
  assert.notEqual(run(code,dest,sha).status,0,'source symlinks are rejected');assert.equal(await readFile(outside,'utf8'),'untouched');
 }finally{await rm(temp,{recursive:true,force:true});}
});
