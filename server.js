import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/progress.js': ['progress.js', 'text/javascript'] };
const server = createServer(async (req, res) => {
  const file = files[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await readFile(new URL(file[0], import.meta.url));
    res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(500); res.end('Unable to load application'); }
});
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`My Character listening on port ${server.address().port}`));
