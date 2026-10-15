import test from 'node:test';
import assert from 'node:assert/strict';
import {bodyShape} from './avatar-shape.js';
test('first levels retain an untrained body, visible progress is gradual and capped',()=>{
 const profile={height:175,weight:78};
 assert.deepEqual(bodyShape(1,profile),bodyShape(2,profile));
 assert.deepEqual(bodyShape(1,profile),bodyShape(7,profile));
 assert.ok(bodyShape(20,profile).trained<.25);
 assert.ok(bodyShape(60,profile).trained>bodyShape(20,profile).trained);
 assert.deepEqual(bodyShape(100,profile),bodyShape(60,profile));
});
test('profile weight modestly affects the initial soft silhouette without a fitness score',()=>{
 assert.ok(bodyShape(1,{height:175,weight:95}).softness>bodyShape(1,{height:175,weight:65}).softness);
});
