import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,symlink,writeFile,chmod} from 'node:fs/promises';
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

test('connector update preserves private state and tunnel, and restores code if API restart fails',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'tg-updater-'));
 try{
  const {text,sha,source}=await garminInstaller();
  const update=text.split('# END_GARMIN_SOURCE\n')[1].split('\nexport DEBIAN_FRONTEND')[0];
  const python=spawnSync('python3',['-c','import sys; print(sys.executable)'],{encoding:'utf8'}).stdout.trim();
  for(const fail of [false,true]){
   const fixture=join(temp,String(fail)),root=join(fixture,'root'),bundle=join(fixture,'bundle'),bin=join(fixture,'bin');
   await mkdir(join(root,'app'),{recursive:true});await mkdir(join(root,'venv','bin'),{recursive:true});await mkdir(join(bundle,'source'),{recursive:true});await mkdir(bin);
   await writeFile(join(root,'.diary-garmin'),'fixture');await symlink(python,join(root,'venv','bin','python'));
   await writeFile(join(root,'private-state'),'fixture-only-session-and-tunnel-unchanged');
   const unit=join(fixture,'tg-garmin-api.service');await writeFile(unit,'[Service]\nMemoryMax=128M\n');
   for(const [name,content]of Object.entries(source)){await writeFile(join(bundle,'source',name),content);await writeFile(join(root,'app',name),name.endsWith('.txt')?content:'# previous fixture code\n');}
   const systemctl=join(bin,'systemctl');await writeFile(systemctl,`#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$TG_UPDATE_FIXTURE/log"
if [[ "$*" == 'start tg-garmin-api.service' && -e "$TG_UPDATE_FIXTURE/fail-once" ]]; then
 rm "$TG_UPDATE_FIXTURE/fail-once"
 exit 1
fi
`);await chmod(systemctl,0o755);
   if(fail)await writeFile(join(fixture,'fail-once'),'fixture');
   const result=spawnSync('bash',['-c',`set -euo pipefail
tg_root="$TG_UPDATE_FIXTURE/root"
tg_temp="$TG_UPDATE_FIXTURE/bundle"
tg_bundle_sha="$TG_UPDATE_SHA"
tg_update=true
${update.replace('/etc/systemd/system/tg-garmin-api.service',unit)}`],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,TG_UPDATE_FIXTURE:fixture,TG_UPDATE_SHA:sha}});
   assert.equal(result.status,fail?1:0,result.stderr);
   assert.equal(await readFile(join(root,'private-state'),'utf8'),'fixture-only-session-and-tunnel-unchanged');
   assert.match(await readFile(unit,'utf8'),fail?/MemoryMax=128M/:/MemoryMax=384M/);
   assert.equal(await readFile(join(root,'app','health.py'),'utf8'),fail?'# previous fixture code\n':source['health.py']);
   const calls=await readFile(join(fixture,'log'),'utf8');assert.doesNotMatch(calls,/tunnel|xray|x-ui|ssh|firewall/);assert.match(calls,/start tg-garmin-sync.timer/);
   if(fail)assert.match(result.stderr,/previous Garmin code restored/);
  }
 }finally{await rm(temp,{recursive:true,force:true});}
});
