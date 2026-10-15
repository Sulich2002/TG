import {mkdir,copyFile,rm} from 'node:fs/promises';
await mkdir('vendor',{recursive:true});
for(const name of ['three.module.js','three.core.js'])await copyFile(`node_modules/three/build/${name}`,`vendor/${name}`);
await copyFile('node_modules/three/LICENSE','vendor/THREE-LICENSE.txt');
await rm('_site',{recursive:true,force:true});
await mkdir('_site/vendor',{recursive:true});
for(const name of ['index.html','style.css','app.js','progress.js','avatar.js','avatar-shape.js'])await copyFile(name,`_site/${name}`);
for(const name of ['three.module.js','three.core.js','THREE-LICENSE.txt'])await copyFile(`vendor/${name}`,`_site/vendor/${name}`);
console.log('Static Mini App and local 3D modules ready in _site.');
