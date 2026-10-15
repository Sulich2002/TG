import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('anatomical assets match their recorded source and contain valid unbroken geometry',async()=>{
 const checksums=JSON.parse(await readFile(new URL('./assets/human/source-sha256.json',import.meta.url)));
 for(const [name,expected]of Object.entries(checksums)){
  const bytes=await readFile(new URL('./assets/human/source/'+name,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,name);
 }
 const meta=JSON.parse(await readFile(new URL('./assets/human/model/mesh.json',import.meta.url))),length=meta.vertices*3;
 for(const sex of ['male','female']){
  const bytes=await readFile(new URL(`./assets/human/model/${sex}.bin`,import.meta.url));
  const values=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));assert.equal(values.length,length*3);
  for(const coordinate of values)assert.ok(Number.isFinite(coordinate));
  for(let shape=0;shape<3;shape++)for(let i=0;i<meta.body.length;i+=3){
   const face=meta.body.slice(i,i+3);for(const index of face)assert.ok(index>=0&&index<meta.vertices);
   for(const [a,b]of [[face[0],face[1]],[face[1],face[2]],[face[2],face[0]]]){
    const ai=shape*length+a*3,bi=shape*length+b*3;
    assert.ok(Math.hypot(values[ai]-values[bi],values[ai+1]-values[bi+1],values[ai+2]-values[bi+2])<1.5,`${sex} has a stretched triangle`);
   }
  }
 }
});
