// Gesamtvergleich mehrerer Ruhepol-Stände auf echten Seiten (braucht Internet).
//   tools/versionen.sh 1.21.0 aktuell
//   VERS=1.21.0,aktuell ROUNDS=3 node tools/vergleich.mjs https://orf.at https://www.derstandard.at …
//   node tools/auswertung.mjs .vergleich/vergleich.json
// KI=0 schaltet den Bedeutungs-Filter aus (Bildzeiten ohne Wartezeit auf die KI), OUT=datei.json ändert die Ausgabe.
// Die Stände werden abwechselnd geladen, jeweils wie ein erster Besuch (Seitentexte und Bilder vergessen,
// Modell bleibt geladen). Je Seitenaufruf (15 s): wie lange sichtbare harmlose Bilder nach dem Laden unscharf
// bleiben, wie schnell die KI sichtbare Teaser erkennt, Blockierzeit (lange Tasks über 50 ms), Treffer.
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = join(ROOT, '.vergleich') + '/';
const VERS = (process.env.VERS || 'aktuell').split(',');
const ROUNDS = +(process.env.ROUNDS || 3);
const KI = process.env.KI !== '0'; // KI=0: Bedeutungs-Filter aus, misst die Texterkennung allein
const URLS = process.argv.slice(2);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const INIT = () => {
  const ins = new WeakMap(); const res = (window.__vb = { ki: [], img: new Map(), long: [] });
  const t = () => performance.now();
  new PerformanceObserver((l) => { for (const e of l.getEntries()) res.long.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  document.addEventListener('load', (e) => { const el = e.target; if (el && el.tagName === 'IMG') { const r = res.img.get(el) || {}; if (r.load === undefined) r.load = t(); res.img.set(el, r); } }, true);
  new MutationObserver((recs) => {
    const now = t();
    for (const r of recs) {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) { if (n.nodeType !== 1) continue; if (!ins.has(n)) ins.set(n, now); for (const d of n.querySelectorAll('*')) if (!ins.has(d)) ins.set(d, now); }
      } else if (r.attributeName === 'data-sf' && r.target.tagName === 'IMG') {
        const st = r.target.dataset.sf; const x = res.img.get(r.target) || {}; if (x.ins === undefined) x.ins = ins.get(r.target) ?? 0;
        if (st === 'ok' && x.ok === undefined) x.ok = now; if (st === 'hit' && x.hit === undefined) x.hit = now; res.img.set(r.target, x);
      } else if (r.attributeName === 'data-sf-hit' && r.target.dataset.sfHit && r.target.dataset.sfWhy === 'ki') {
        const b = r.target; let i0 = ins.get(b) ?? Infinity; for (const d of b.querySelectorAll('*')) { const v = ins.get(d); if (v !== undefined && v < i0) i0 = v; }
        const rect = b.getBoundingClientRect(); if (i0 === Infinity) i0 = 0;
        res.ki.push({ d: now - i0, vis: rect.top < innerHeight && rect.bottom > 0 });
      }
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sf', 'data-sf-hit'] });
};
const COLLECT = () => {
  const r = window.__vb; const imgs = [];
  for (const [el, x] of r.img) {
    if (!el.isConnected || x.ok === undefined || x.load === undefined) continue;
    const b = el.getBoundingClientRect(); if (!(b.width >= 120 && b.height >= 80 && b.top < innerHeight && b.bottom > 0)) continue;
    imgs.push(Math.max(0, x.ok - Math.max(x.load, x.ins || 0)));
  }
  const tbt = r.long.reduce((s, d) => s + Math.max(0, d - 50), 0);
  return { imgs, ki: r.ki.filter((k) => k.vis).map((k) => k.d), tbt, longMax: Math.max(0, ...r.long), hits: document.querySelectorAll('[data-sf-hit]').length };
};
async function consent(p) {
  for (const f of p.frames()) for (const l of ['Einverstanden', 'Alle akzeptieren', 'Akzeptieren', 'Zustimmen', 'Alle Cookies akzeptieren', 'Accept all', 'Alle zulassen', 'Ich stimme zu', 'AKZEPTIEREN']) {
    const b = f.getByRole('button', { name: l, exact: true }); if (await b.count().catch(() => 0)) { if (await b.first().click({ timeout: 2000 }).then(() => true, () => false)) return; }
  }
}
const ctxs = {};
for (const v of VERS) {
  const ext = D + v + '/extension';
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ruhepol-prof-')), { channel: 'chromium', headless: true, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 1000 }, locale: 'de-AT', userAgent: UA,
    args: ['--disable-quic', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--ignore-certificate-errors'] });
  let sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')); while (!sw) { const w = await ctx.waitForEvent('serviceworker'); if (w.url().startsWith('chrome-extension://')) sw = w; }
  for (let i = 0; i < 100; i++) { const k = await sw.evaluate(async () => Object.keys(await chrome.storage.sync.get(null))).catch(() => []); if (k.includes('onError')) break; await new Promise((r) => setTimeout(r, 50)); }
  await sw.evaluate(async (ki) => { await chrome.storage.local.remove('semModel'); await chrome.storage.sync.set({ semantic: ki, semanticVeto: ki, positiveShow: ki, nanoCheck: false, display: 'blur' }); }, KI);
  await new Promise((r) => setTimeout(r, 500));
  for (const p of ctx.pages()) if (p.url().includes('kennenlernen')) await p.close().catch(() => {});
  await ctx.addInitScript(INIT);
  const pw = await ctx.newPage(); await pw.goto('https://de.wikipedia.org/wiki/Graz', { waitUntil: 'domcontentloaded' }).catch(() => {}); await pw.waitForTimeout(15000); await pw.close();
  for (const url of URLS) { const p0 = await ctx.newPage(); await p0.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}); await p0.waitForTimeout(3000); await consent(p0); await p0.waitForTimeout(6000); await p0.close(); }
  const baseKeys = await sw.evaluate(async () => (await chrome.storage.local.getKeys()).filter((k) => k.startsWith('sv1:')));
  ctxs[v] = { ctx, sw, baseKeys };
  console.error('bereit', v);
}
const out = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const url of URLS) {
    const order = VERS.slice(round % VERS.length).concat(VERS.slice(0, round % VERS.length));
    for (const v of order) {
      const { ctx, sw, baseKeys } = ctxs[v];
      // Seitentexte und Bilder vergessen (wie ein erster Besuch), Modell bleibt geladen.
      await sw.evaluate(async (baseKeys) => {
        const keep = new Set(baseKeys);
        const keys = await chrome.storage.local.getKeys();
        await chrome.storage.local.remove(keys.filter((k) => (k.startsWith('sv1:') && !keep.has(k)) || k.startsWith('ocr')));
        try { semCache.clear(); } catch (_) {}
        try { cacheIndex = null; cacheIndexPromise = null; } catch (_) {}
      }, baseKeys).catch((e) => console.error('reset', v, e.message));
      const p = await ctx.newPage();
      // Zeitmesspunkte aus einem eingebauten Messstand (Konsolenzeilen „SFDIAG {…}“), sonst leer
      const diag = [];
      p.on('console', (m) => { const t = m.text(); if (t.startsWith('SFDIAG ')) try { diag.push(JSON.parse(t.slice(7))); } catch (_) {} });
      try {
        await p.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
        await p.waitForTimeout(15000);
        const r = await p.evaluate(COLLECT);
        out.push({ round, url, v, ...r, ...(diag.length ? { diag } : {}) });
        const med = (a) => a.length ? Math.round(a.slice().sort((x, y) => x - y)[a.length >> 1]) : null;
        console.error(round, url, v, 'bilder', r.imgs.length, med(r.imgs), 'ki', r.ki.length, med(r.ki), 'tbt', Math.round(r.tbt), 'treffer', r.hits);
      } catch (e) { console.error('Fehler', url, v, e.message); }
      await p.close();
      writeFileSync(D + (process.env.OUT || 'vergleich.json'), JSON.stringify(out));
    }
  }
}
for (const v of VERS) await ctxs[v].ctx.close();
