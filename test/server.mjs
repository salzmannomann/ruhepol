// Zwei lokale Server: Seite auf Port A, Bilder auf Port B (anderer Ursprung, ohne CORS-Header).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript' };

const served = new Set();

function serve(root, transform) {
  return createServer(async (req, res) => {
    // /once/<datei>?<id>: wird genau einmal ausgeliefert, danach 404 (simuliert Ladefehler beim Nachladen).
    if (req.url.startsWith('/once/')) {
      if (served.has(req.url)) { res.writeHead(404); res.end('weg'); return; }
      served.add(req.url);
      req.url = req.url.slice(5);
    }
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\.\.+/g, '');
    if (path.endsWith('/')) path += 'index.html';
    try {
      let body = await readFile(join(root, path));
      if (transform && path.endsWith('.html')) body = transform(body.toString());
      res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

export async function startServers() {
  const img = serve(join(dir, 'fixtures'));
  const imgPort = await listen(img);
  const imgBase = `http://localhost:${imgPort}`; // anderer Ursprung als 127.0.0.1
  const page = serve(join(dir, 'site'), (html) => html.replaceAll('{{IMG}}', imgBase));
  const pagePort = await listen(page);
  return {
    base: `http://127.0.0.1:${pagePort}`,
    imgBase,
    close: () => { img.close(); page.close(); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startServers();
  console.log(`Testseite: ${s.base}/  (Bilder von ${s.imgBase})`);
}
