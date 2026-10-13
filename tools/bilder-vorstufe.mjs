// Misst an den mit tools/bilder-sammeln.mjs gefundenen Bildern (.vergleich/bilder/, nur lokal):
//   voll   – Texterkennung wie in Ruhepol (Sprachen wie angegeben, SPARSE_TEXT, Wörter gefiltert)
//   layout – nur Tesseracts Seitenaufteilung („wo sind Textzeilen?“), ohne Buchstaben zu erkennen
// Je Bild Zeit und Ergebnis. Die Bilder werden genauso vorbereitet wie im Offscreen Document.
//   node tools/bilder-vorstufe.mjs [deu+eng|deu] [Durchgänge]   → .vergleich/bilder/vorstufe-<Sprachen>.json
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = join(ROOT, '.vergleich', 'bilder') + '/';
const LANGS = (process.argv[2] || 'deu+eng').split('+');
const RUNS = +(process.argv[3] || 1);
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
  pick(/const MAX_SIDE[\s\S]*?const MAX_UPSCALE = \d+;/),
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
await page.evaluate(async (LANGS) => {
  const base = location.origin + '/v/';
  window.W = await Tesseract.createWorker(LANGS, Tesseract.OEM.LSTM_ONLY, {
    workerPath: base + 'worker.min.js', corePath: base + 'core/', langPath: base + 'lang', gzip: false, cacheMethod: 'none', workerBlobURL: false,
  });
  await W.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
}, LANGS);

const out = [];
for (const c of items) {
  const r = await page.evaluate(async ({ id, RUNS }) => {
    let canvas;
    try { canvas = await prepare('/b/' + id); } catch (_) { return null; }
    const bmp = canvasToPpm(canvas);
    // halbe Größe für eine billigere Vorstufe
    const half = document.createElement('canvas');
    half.width = Math.max(1, canvas.width >> 1); half.height = Math.max(1, canvas.height >> 1);
    const hx = half.getContext('2d'); hx.imageSmoothingQuality = 'high'; hx.drawImage(canvas, 0, 0, half.width, half.height);
    const bmpHalf = canvasToPpm(half);
    const lines = (blocks) => (blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => (p.lines || []).map((l) => ({
      x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1, rh: l.rowAttributes && l.rowAttributes.rowHeight, bt: b.blocktype,
      words: (l.words || []).length, sym: (l.words || []).reduce((s, w) => s + (w.symbols || []).length, 0) }))));
    const res = { w: canvas.width, h: canvas.height, voll: [], layout: [], layoutHalb: [], leer: [] };
    for (let i = 0; i < RUNS; i++) {
      let t = performance.now();
      await W.recognize(bmp, {}, { text: false });
      res.leer.push(performance.now() - t);
      t = performance.now();
      const L = await W.recognize(bmp, {}, { text: false, layoutBlocks: true });
      res.layout.push(performance.now() - t);
      res.lines = lines(L.data.layoutBlocks);
      t = performance.now();
      const H = await W.recognize(bmpHalf, {}, { text: false, layoutBlocks: true });
      res.layoutHalb.push(performance.now() - t);
      res.linesHalb = lines(H.data.layoutBlocks);
      t = performance.now();
      const F = await W.recognize(bmp, {}, { text: false, tsv: true });
      res.voll.push(performance.now() - t);
      res.text = cleanWords(F.data.tsv);
      res.tsv = F.data.tsv;
    }
    return res;
  }, { id: c.id, RUNS });
  if (r) out.push({ url: c.url, id: c.id, ...r });
  if (out.length % 25 === 0) console.error(out.length, 'von', items.length);
}
const file = D + `vorstufe-${LANGS.join('+')}.json`;
writeFileSync(file, JSON.stringify(out));
console.error('gemessen', out.length, '→', file);
await browser.close(); srv.close();
