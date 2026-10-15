import test from 'node:test';
import assert from 'node:assert/strict';
import {bodyShape} from './avatar-shape.js';
test('character starts with a small belly and gradually becomes more athletic',()=>{
 const start=bodyShape(1),mid=bodyShape(10),trained=bodyShape(20);
 assert.ok(start.belly>mid.belly&&mid.belly>trained.belly);
 assert.ok(start.shoulders<mid.shoulders&&mid.shoulders<trained.shoulders);
 assert.ok(start.arm<trained.arm);assert.deepEqual(bodyShape(100),trained);
});
