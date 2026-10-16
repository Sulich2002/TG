import test from 'node:test';
import assert from 'node:assert/strict';
import {accountLinkData,accountServerLink} from './friends-ui.js';
const base='https://sulich2002.github.io/TG/',server='https://fixture.trycloudflare.com';
test('a public account link carries only the server and opens in a fresh browser',()=>{
 const link=accountServerLink(base+'#join=old',server+'/');
 assert.deepEqual(accountLinkData(link),{url:server});
 assert.deepEqual([...new URLSearchParams(new URL(link).hash.slice(1)).keys()],['server']);
 assert.equal(accountLinkData(base),null);
});
test('existing invitations still prefill account login without granting an account session',()=>{
 const invite='fixture-invitation-0123456789';
 const link=base+'#'+new URLSearchParams({join:JSON.stringify({url:server,invite})});
 assert.deepEqual(accountLinkData(link),{url:server,invite});
 const consumed=accountServerLink(link,server);
 assert.deepEqual(accountLinkData(consumed),{url:server});
 assert.ok(!decodeURIComponent(consumed).includes(invite));
});
test('malformed invitations and unsafe or credential-bearing server links are ignored',()=>{
 for(const url of ['http://example.com','https://user:secret@example.com','https://example.com/path','javascript:alert(1)']){
  assert.equal(accountLinkData(base+'#'+new URLSearchParams({server:url})),null);
  assert.throws(()=>accountServerLink(base,url));
 }
 assert.equal(accountLinkData(base+'#join=broken'),null);
 assert.equal(accountLinkData(base+'#'+new URLSearchParams({join:JSON.stringify({url:server,invite:'short'})})),null);
});
