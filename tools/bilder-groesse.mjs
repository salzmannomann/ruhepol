// Misst, wie groß Bilder für die Texterkennung sein müssen (.vergleich/bilder/, nur lokal):
// je Einstellung „lange Seite höchstens MAX px, Bilder unter UP px bis 2-fach vergrößert“ Zeit und
// gelesene Wörter (Deutsch+Englisch wie in Ruhepol). Auswertung: tools/groesse-auswerten.js
//   node tools/bilder-groesse.mjs 1200/500 1000/500 800/400 …   → .vergleich/bilder/groesse.json
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = join(ROOT, '.vergleich', 'bilder') + '/';
const SETS = process.argv.slice(2).map((a) => a.split('/').map(Number));
const corpus = JSON.parse(readFileSync(D + 'ocr.json', 'utf8'));
for (const c of corpus) c.id = createHash('sha1').update(c.url).digest('hex').slice(0, 16);
mkdirSync(D + 'files', { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--disable-quic', '--ignore-certificate-errors'] });
const dl = await browser.newContext({ ignoreHTTPSErrors: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
for (const c of corpus) {
  if (existsSync(D + 'files/' + c.id) || !/^https?:/.test(c.url)) continue;
  try { const r = await dl.request.get(c.url, { timeout: 20000 }); if (r.ok()) writeFileSync(D + 'files/' + c.id, await r.body()); } catch (_) {}
}
const items = corpus.filter((c) => existsSync(D + 'files/' + c.id));
console.error('Bilder', items.length, 'von', corpus.length);

// Bildvorbereitung und Wortfilter direkt aus offscreen.js, damit die Messung dem Einbau entspricht.
const off = readFileSync(join(ROOT, 'extension', 'offscreen.js'), 'utf8');
const pick = (re) => { const m = off.match(re); if (!m) throw new Error('nicht gefunden: ' + re); return m[0]; };
const lib = [
  'let MAX_SIDE = 1200, UPSCALE_BELOW = 500; const MAX_UPSCALE = 2;',
  pick(/async function decode[\s\S]*?\n}\n/),
  pick(/async function prepare[\s\S]*?\n}\n/),
  pick(/const MIN_WORD_CONF[\s\S]*?\nfunction cleanWords[\s\S]*?\n}\n/),
  pick(/function canvasToPpm[\s\S]*?\n}\n/),
].join('\n');

const VENDOR = join(ROOT, 'extension', 'vendor');
const TYPES = { js: 'text/javascript', wasm: 'application/wasm', html: 'text/html' };
const srv = createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') { res.setHeader('content-type', 'text/html'); res.end('<script src="/v/tesseract.min.js"></script><script>' + lib + '</script>'); return; }
  const file = u.startsWith('/v/') ? join(VENDOR, u.slice(3)) : u.startsWith('/b/') ? D + 'files/' + u.slice(3) : null;
  try { res.setHeader('content-type', TYPES[u.split('.').pop()] || 'application/octet-stream'); res.end(readFileSync(file)); } catch (_) { res.statusCode = 404; res.end(); }
}).listen(0);
await new Promise((r) => srv.on('listening', r));

const page = await (await browser.newContext()).newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error('Seite:', m.text()); });
await page.goto(`http://127.0.0.1:${srv.address().port}/`);
await page.evaluate(async () => {
  const base = location.origin + '/v/';
  window.W = await Tesseract.createWorker(['deu', 'eng'], Tesseract.OEM.LSTM_ONLY, {
    workerPath: base + 'worker.min.js', corePath: base + 'core/', langPath: base + 'lang', gzip: false, cacheMethod: 'none', workerBlobURL: false,
  });
  await W.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
});
const out = [];
for (const c of items) {
  const r = await page.evaluate(async ({ id, SETS }) => {
    const res = {};
    for (const [max, up] of SETS) {
      MAX_SIDE = max; UPSCALE_BELOW = up;
      let canvas;
      try { canvas = await prepare('/b/' + id); } catch (_) { return null; }
      const t = performance.now();
      const F = await W.recognize(canvasToPpm(canvas), {}, { text: false, tsv: true });
      res[max + '/' + up] = { ms: performance.now() - t, w: canvas.width, h: canvas.height, text: cleanWords(F.data.tsv) };
    }
    return res;
  }, { id: c.id, SETS });
  if (r) out.push({ url: c.url, id: c.id, r });
  if (out.length % 50 === 0) console.error(out.length, 'von', items.length);
}
writeFileSync(D + 'groesse.json', JSON.stringify({ SETS: SETS.map((s) => s.join('/')), out }));
console.error('gemessen', out.length);
await browser.close(); srv.close();
