// Lädt die mit tools/bilder-sammeln.mjs gefundenen Bilder (→ .vergleich/bilder/files/) und misst eine
// Vorprüfung „kann hier Schrift stehen?“ (tools/textcheck.js) mit verschiedenen Einstellungen.
// Ergebnis: .vergleich/bilder/eval.json; Auswertung: node tools/bilder-auswerten.js .vergleich/bilder/eval.json
// (1.30.2: einfache Strich-Vorprüfung gemessen und verworfen, siehe README).
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = join(ROOT, '.vergleich', 'bilder') + '/';
mkdirSync(D + 'files', { recursive: true });
const corpus = JSON.parse(readFileSync(D + 'ocr.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chromium', args: ['--disable-quic', '--ignore-certificate-errors'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
let got = 0;
for (const c of corpus) {
  c.id = createHash('sha1').update(c.url).digest('hex').slice(0, 16);
  if (existsSync(D + 'files/' + c.id)) { got++; continue; }
  if (!/^https?:/.test(c.url)) continue;
  try { const r = await ctx.request.get(c.url, { timeout: 20000 }); if (r.ok()) { writeFileSync(D + 'files/' + c.id, await r.body()); got++; } } catch (_) {}
}
console.error('heruntergeladen', got, 'von', corpus.length);
const lib = readFileSync(join(ROOT, 'tools', 'textcheck.js'), 'utf8');
const srv = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<script>' + lib + '</script>'); return; }
  try { res.end(readFileSync(D + 'files/' + req.url.slice(1))); } catch (_) { res.statusCode = 404; res.end(); }
}).listen(0);
await new Promise((r) => srv.on('listening', r));
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${srv.address().port}/`);
const GRID = [];
for (const edge of [20, 28, 36, 48]) for (const stroke of [10, 14, 20]) for (const cellStrokes of [0.6, 0.9, 1.2, 1.6, 2.0]) GRID.push({ edge, stroke, cellStrokes });
const out = [];
for (const c of corpus) {
  if (!existsSync(D + 'files/' + c.id)) continue;
  const r = await page.evaluate(async ({ id, GRID }) => {
    const blob = await (await fetch('/' + id)).blob();
    let src; try { src = await createImageBitmap(blob); } catch (_) { return null; }
    const w = src.width, h = src.height; const long = Math.max(w, h);
    let scale = 1; if (long > 1200) scale = 1200 / long; else if (long < 500) scale = Math.min(2, 1200 / long);
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, cw, ch);
    const px = x.getImageData(0, 0, cw, ch).data;
    const t0 = performance.now(); SFTextCheck.measure(px, cw, ch); const ms = performance.now() - t0;
    return { w: cw, h: ch, ms, runs: GRID.map((g) => SFTextCheck.measure(px, cw, ch, g).run) };
  }, { id: c.id, GRID });
  if (r) out.push({ url: c.url, text: c.text, ...r });
}
writeFileSync(D + 'eval.json', JSON.stringify({ GRID, out }));
console.error('gemessen', out.length);
await browser.close(); srv.close();
