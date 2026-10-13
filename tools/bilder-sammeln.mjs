// Sammelt echte Nachrichtenbilder, die Ruhepol per Texterkennung prüft, samt erkanntem Text
// → .vergleich/bilder/ocr.json (nur lokal, fremde Bilder und Texte gehören nicht ins Repo).
//   node tools/bilder-sammeln.mjs https://orf.at https://www.derstandard.at …
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = join(ROOT, '.vergleich') + '/';
mkdirSync(D + 'bilder', { recursive: true });
const ext = join(ROOT, 'extension');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ruhepol-prof-')), { channel: 'chromium', headless: true, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 1000 }, locale: 'de-AT', userAgent: UA,
  args: ['--disable-quic', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--ignore-certificate-errors'] });
let sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')); while (!sw) { const w = await ctx.waitForEvent('serviceworker'); if (w.url().startsWith('chrome-extension://')) sw = w; }
for (let i = 0; i < 100; i++) { const k = await sw.evaluate(async () => Object.keys(await chrome.storage.sync.get(null))).catch(() => []); if (k.includes('onError')) break; await new Promise((r) => setTimeout(r, 50)); }
// Alles prüfen: keine Listen (sonst entfallen Bilder, deren Teaser schon unscharf ist), Bilder auch auf ruhigen Seiten
await sw.evaluate(async () => { await chrome.storage.sync.set({ presets: [], keywords: ['Qwyxzv'], semantic: false, learn: false, calmImages: false }); });
for (const p of ctx.pages()) if (p.url().includes('kennenlernen')) await p.close().catch(() => {});
async function consent(p) {
  for (const f of p.frames()) for (const l of ['Einverstanden', 'Alle akzeptieren', 'Akzeptieren', 'Zustimmen', 'Alle Cookies akzeptieren', 'Accept all', 'Alle zulassen', 'Ich stimme zu']) {
    const b = f.getByRole('button', { name: l, exact: true }); if (await b.count().catch(() => 0)) { if (await b.first().click({ timeout: 2000 }).then(() => true, () => false)) return; }
  }
}
for (const url of process.argv.slice(2)) {
  const p = await ctx.newPage();
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(2500); await consent(p); await p.waitForTimeout(1500);
    for (let y = 0; y < 14; y++) { await p.mouse.wheel(0, 900); await p.waitForTimeout(700); }
    await p.waitForTimeout(6000);
  } catch (e) { console.error(url, e.message); }
  await p.close().catch(() => {});
  const all = await Promise.race([sw.evaluate(async () => { const keys = (await chrome.storage.local.getKeys()).filter((k) => k.startsWith('ocr2:')); const r = await chrome.storage.local.get(keys); return Object.entries(r).map(([k, v]) => ({ url: k.slice(5), text: v.t || '' })); }), new Promise((r) => setTimeout(() => r(null), 20000))]);
  if (all) writeFileSync(D + 'bilder/ocr.json', JSON.stringify(all, null, 1));
  console.error(new Date().toISOString().slice(11, 19), url, 'Bilder bisher', all ? all.length : '?', 'mit Text', all ? all.filter((x) => x.text.trim()).length : '?');
}
await ctx.close();
process.exit(0);
