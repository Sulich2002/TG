import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/progress.js': ['progress.js', 'text/javascript'], '/profile.js':['profile.js','text/javascript'], '/avatar.js':['avatar.js','text/javascript'], '/avatar-shape.js':['avatar-shape.js','text/javascript'], '/vendor/three.module.js':['vendor/three.module.js','text/javascript'], '/vendor/three.core.js':['vendor/three.core.js','text/javascript'] };
const server = createServer(async (req, res) => {
  const pathname=new URL(req.url, 'http://localhost').pathname;
  const assetPaths={
    '/assets/human/model/mesh.json':['assets/human/model/mesh.json','application/json'],
    '/assets/human/model/male.bin':['assets/human/model/male.bin','application/octet-stream'],
    '/assets/human/model/female.bin':['assets/human/model/female.bin','application/octet-stream'],
    '/assets/human/brown_eye.png':['assets/human/source/brown_eye.png','image/png']
  };
  const file=Object.hasOwn(files,pathname)?files[pathname]:assetPaths[pathname];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await readFile(new URL(file[0], import.meta.url));
    res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(500); res.end('Unable to load application'); }
});
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`My Character listening on port ${server.address().port}`));
