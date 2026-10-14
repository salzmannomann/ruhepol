// Misst „mit Deutsch lesen, unsichere Zeilen mit Deutsch+Englisch nachlesen“ an den mit
// tools/bilder-sammeln.mjs gefundenen Bildern (.vergleich/bilder/, nur lokal). Je Bild:
//   ref   – volle Texterkennung Deutsch+Englisch (Stand 1.30.3), Zeit und Text
//   deu   – volle Texterkennung nur Deutsch, Zeit und alle Wörter mit Sicherheit
//   zeilen – jede Zeile mit einem unsicheren Wort (Sicherheit < 70, mind. 2 Buchstaben) ausgeschnitten
//            und mit Deutsch+Englisch nachgelesen: Zeit und Text je Zeile
// Auswertung (welche Zeilen nachlesen, ab wie vielen das ganze Bild): tools/nachlesen-auswerten.js
//   node tools/bilder-nachlesen.mjs   → .vergleich/bilder/nachlesen.json
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = join(ROOT, '.vergleich', 'bilder') + '/';
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
await page.evaluate(async () => {
  const base = location.origin + '/v/';
  const make = async (langs) => {
    const w = await Tesseract.createWorker(langs, Tesseract.OEM.LSTM_ONLY, {
      workerPath: base + 'worker.min.js', corePath: base + 'core/', langPath: base + 'lang', gzip: false, cacheMethod: 'none', workerBlobURL: false,
    });
    await w.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
    return w;
  };
  window.WDE = await make(['deu']);
  window.WALL = await make(['deu', 'eng']);
});

const out = [];
for (const c of items) {
  const r = await page.evaluate(async ({ id }) => {
    let canvas;
    try { canvas = await prepare('/b/' + id); } catch (_) { return null; }
    const ppm = canvasToPpm(canvas);
    let t = performance.now();
    const ref = await WALL.recognize(ppm, {}, { text: false, tsv: true });
    const refMs = performance.now() - t;
    t = performance.now();
    const de = await WDE.recognize(ppm, {}, { text: false, tsv: true });
    const deMs = performance.now() - t;
    // Zeilen (Ebene 4) mit Lage; Wörter (Ebene 5) mit Sicherheit
    const lines = new Map();
    for (const row of de.data.tsv.split('\n')) {
      const c = row.split('\t');
      if (c.length < 12) continue;
      const key = `${c[2]}.${c[3]}.${c[4]}`;
      if (c[0] === '4') lines.set(key, { key, x: +c[6], y: +c[7], w: +c[8], h: +c[9], words: [] });
      else if (c[0] === '5' && lines.has(key)) {
        const word = c.slice(11).join('\t').trim();
        lines.get(key).words.push({ w: word, conf: +c[10], L: (word.match(/\p{L}/gu) || []).length });
      }
    }
    const zeilen = [];
    for (const l of lines.values()) {
      if (!l.words.some((x) => x.L >= 2 && x.conf < 70)) continue;
      const pad = Math.max(8, Math.round(l.h * 0.5));
      const x0 = Math.max(0, l.x - pad), y0 = Math.max(0, l.y - pad);
      const x1 = Math.min(canvas.width, l.x + l.w + pad), y1 = Math.min(canvas.height, l.y + l.h + pad);
      const cut = document.createElement('canvas');
      cut.width = x1 - x0; cut.height = y1 - y0;
      cut.getContext('2d').drawImage(canvas, x0, y0, cut.width, cut.height, 0, 0, cut.width, cut.height);
      t = performance.now();
      const z = await WALL.recognize(canvasToPpm(cut), {}, { text: false, tsv: true });
      zeilen.push({ key: l.key, h: l.h, words: l.words, ms: performance.now() - t, text: cleanWords(z.data.tsv) });
    }
    const deText = [...lines.values()].map((l) => ({ key: l.key, text: cleanWords(l.words.map((x) => `5\t1\t${l.key.replace(/\./g, '\t')}\t1\t0\t0\t0\t0\t${x.conf}\t${x.w}`).join('\n')) }));
    return { w: canvas.width, h: canvas.height, refMs, ref: cleanWords(ref.data.tsv), deMs, de: cleanWords(de.data.tsv), deLines: deText, zeilen };
  }, { id: c.id });
  if (r) out.push({ url: c.url, id: c.id, ...r });
  if (out.length % 25 === 0) console.error(out.length, 'von', items.length);
}
writeFileSync(D + 'nachlesen.json', JSON.stringify(out));
console.error('gemessen', out.length, '→', D + 'nachlesen.json');
await browser.close(); srv.close();
