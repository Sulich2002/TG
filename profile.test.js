import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProfile} from './profile.js';
test('profile creation validates explicit personal fields and keeps Unicode names',()=>{
 assert.deepEqual(normalizeProfile({sex:'female',name:'  Саша ',age:'28',height:'165',weight:'65,5'}),{sex:'female',name:'Саша',age:28,height:165,weight:65.5});
});
test('absent, partial and invalid profiles require setup instead of fabricated defaults',()=>{
 assert.equal(normalizeProfile(null),null);
 assert.equal(normalizeProfile({sex:'male',name:'',age:28,height:175,weight:78}),null);
 assert.equal(normalizeProfile({sex:'male',name:'Пётр',age:28,height:0,weight:78}),null);
 assert.equal(normalizeProfile({sex:'unknown',name:'Пётр',age:28,height:175,weight:78}),null);
});
