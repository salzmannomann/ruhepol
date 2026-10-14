// Rechenzeit der Erweiterung im Hauptthread der Seite (CDP-Profiler), je Stand und Seite, mit den
// teuersten Funktionen (inkl. ausgelöstem Layout) und Gesamtzeit je Funktion samt allem, was sie aufruft
// (Feld incl, z. B. „Datei match.js“ = Schlagwortabgleich). Braucht Internet.
//   tools/versionen.sh 1.29.3 aktuell
//   VERS=1.29.3,aktuell ROUNDS=3 node tools/profil.mjs https://www.derstandard.at https://kurier.at
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = join(ROOT, '.vergleich') + '/';
const VERS = (process.env.VERS || 'aktuell').split(',');
const ROUNDS = +(process.env.ROUNDS || 2);
const URLS = process.argv.slice(2);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
async function consent(p) {
  for (const f of p.frames()) for (const l of ['Einverstanden', 'Alle akzeptieren', 'Akzeptieren', 'Zustimmen', 'Alle Cookies akzeptieren', 'Accept all', 'Alle zulassen', 'Ich stimme zu']) {
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
  await sw.evaluate(async () => { await chrome.storage.local.remove('semModel'); await chrome.storage.sync.set({ semantic: true, semanticVeto: true, positiveShow: true, nanoCheck: false, display: 'blur' }); });
  await new Promise((r) => setTimeout(r, 500));
  for (const p of ctx.pages()) if (p.url().includes('kennenlernen')) await p.close().catch(() => {});
  const pw = await ctx.newPage(); await pw.goto('https://de.wikipedia.org/wiki/Graz', { waitUntil: 'domcontentloaded' }).catch(() => {}); await pw.waitForTimeout(12000); await pw.close();
  for (const url of URLS) { const p0 = await ctx.newPage(); await p0.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}); await p0.waitForTimeout(3000); await consent(p0); await p0.waitForTimeout(5000); await p0.close(); }
  const baseKeys = await sw.evaluate(async () => (await chrome.storage.local.getKeys()).filter((k) => k.startsWith('sv1:')));
  ctxs[v] = { ctx, sw, baseKeys };
  console.error('bereit', v);
}
const out = [];
for (let round = 0; round < ROUNDS; round++) for (const url of URLS) {
  const order = VERS.slice(round % VERS.length).concat(VERS.slice(0, round % VERS.length));
  for (const v of order) {
    const { ctx, sw, baseKeys } = ctxs[v];
    await sw.evaluate(async (baseKeys) => {
      const keep = new Set(baseKeys); const keys = await chrome.storage.local.getKeys();
      await chrome.storage.local.remove(keys.filter((k) => (k.startsWith('sv1:') && !keep.has(k)) || k.startsWith('ocr')));
      try { semCache.clear(); } catch (_) {} try { cacheIndex = null; cacheIndexPromise = null; } catch (_) {}
    }, baseKeys).catch(() => {});
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
    await p.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
    await p.waitForTimeout(15000);
    const { profile } = await cdp.send('Profiler.stop');
    // Selbstzeit je Knoten aus Samples
    const dt = new Map(); const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) || 0) + (profile.timeDeltas[i + 1] || 0) / 1000));
    let ext = 0; const fn = {};
    for (const [id, ms] of dt) { const n = nodes.get(id); const u = n.callFrame.url || ''; if (u.startsWith('chrome-extension://')) { ext += ms; const k = (n.callFrame.functionName || '(anon)') + ' ' + u.split('/').pop() + ':' + n.callFrame.lineNumber; fn[k] = (fn[k] || 0) + ms; } }
    // inkl. Layout/Style, die von Erweiterungsfunktionen ausgelöst werden: Kinder ohne URL unter Erweiterungsknoten
    const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    let extIncl = 0;
    for (const [id, ms] of dt) { let cur = id; while (cur !== undefined) { const n = nodes.get(cur); if ((n.callFrame.url || '').startsWith('chrome-extension://')) { extIncl += ms; break; } cur = parent.get(cur); } }
    // Zeit je Erweiterungsfunktion inkl. ausgelöster Browser-Arbeit (Layout usw.), ohne andere Erweiterungsfunktionen
    const own = {};
    for (const [id, ms] of dt) { let cur = id; while (cur !== undefined) { const n = nodes.get(cur); const u = n.callFrame.url || ''; if (u.startsWith('chrome-extension://')) { const k = (n.callFrame.functionName || '(anon)') + ' ' + u.split('/').pop(); own[k] = (own[k] || 0) + ms; break; } cur = parent.get(cur); } }
    const top = Object.entries(own).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, ms]) => `${k}=${Math.round(ms)}`);
    // Gesamtzeit je Erweiterungsfunktion (alles, was darunter läuft, auch andere Erweiterungsfunktionen),
    // je Probe jede Funktion nur einmal gezählt; „Datei match.js“ = Zeit, in der der Schlagwortabgleich läuft
    const incl = {};
    for (const [id, ms] of dt) {
      const seen = new Set(); let cur = id;
      while (cur !== undefined) {
        const n = nodes.get(cur); const u = n.callFrame.url || '';
        if (u.startsWith('chrome-extension://')) {
          const f = u.split('/').pop();
          for (const k of [(n.callFrame.functionName || '(anon)') + ' ' + f, 'Datei ' + f]) if (!seen.has(k)) { seen.add(k); incl[k] = (incl[k] || 0) + ms; }
        }
        cur = parent.get(cur);
      }
    }
    const inclTop = Object.entries(incl).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, ms]) => `${k}=${Math.round(ms)}`);
    out.push({ round, url, v, ext, extIncl, top, incl: inclTop });
    console.error(round, url, v, 'eigen', Math.round(ext), 'inkl', Math.round(extIncl));
    await p.close();
    writeFileSync(D + (process.env.OUT || 'profil.json'), JSON.stringify(out));
  }
}
for (const v of VERS) await ctxs[v].ctx.close();
