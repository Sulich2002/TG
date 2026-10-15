import {buildGarminInstaller} from './build-garmin-installer.mjs';
import {mkdir,copyFile,rm,cp} from 'node:fs/promises';
await mkdir('vendor',{recursive:true});
for(const name of ['three.module.js','three.core.js'])await copyFile(`node_modules/three/build/${name}`,`vendor/${name}`);
await copyFile('node_modules/three/LICENSE','vendor/THREE-LICENSE.txt');
await rm('_site',{recursive:true,force:true});
await mkdir('_site/vendor',{recursive:true});
for(const name of ['index.html','style.css','app.js','garmin.js','garmin-ui.js','progress.js','avatar.js','avatar-shape.js','profile.js'])await copyFile(name,`_site/${name}`);
for(const name of ['three.module.js','three.core.js','THREE-LICENSE.txt'])await copyFile(`vendor/${name}`,`_site/vendor/${name}`);
console.log('Static Mini App and local 3D modules ready in _site.');

await mkdir('_site/assets/human',{recursive:true});
await cp('assets/human/model','_site/assets/human/model',{recursive:true});
await copyFile('assets/human/source/brown_eye.png','_site/assets/human/brown_eye.png');
await copyFile('assets/human/source/LICENSE.ASSETS.md','_site/assets/human/LICENSE.md');
await copyFile('assets/human/SOURCE.md','_site/assets/human/SOURCE.md');

await buildGarminInstaller('_site/garmin-setup.sh');
