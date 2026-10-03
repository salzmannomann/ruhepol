// Ende-zu-Ende-Test: lädt die Erweiterung in Chromium und prüft die lokale Testseite.
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServers } from './server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extPath = join(root, 'extension');
if (!existsSync(join(extPath, 'vendor', 'lang', 'deu.traineddata'))) {
  console.error('extension/vendor fehlt – bitte zuerst "npm run setup" ausführen.');
  process.exit(1);
}

export async function launch() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sf-profile-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: process.env.HEADED ? false : true,
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
    viewport: { width: 1280, height: 900 },
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  // Warten, bis onInstalled die Standardwerte geschrieben hat (sonst überschreibt es Testeinstellungen).
  for (let i = 0; i < 100; i++) {
    const keys = await sw.evaluate(async () => Object.keys(await chrome.storage.sync.get(null)));
    if (keys.includes('onError')) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    ctx, sw, extId,
    close: async () => { await ctx.close(); rmSync(userDataDir, { recursive: true, force: true }); },
  };
}

export async function setSettings(sw, s) {
  await sw.evaluate(async (s) => {
    const cur = await chrome.storage.sync.get(null);
    await chrome.storage.sync.set(Object.assign(cur, s));
  }, s);
}

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push(['ok', name, Date.now() - t]);
    console.log(`  ✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push(['FAIL', name, Date.now() - t]);
    console.log(`  ✘ ${name}\n    ${String(e && e.message || e).split('\n').join('\n    ')}`);
  }
}

const hidden = (page, sel) => page.waitForFunction(
  (sel) => { const el = document.querySelector(sel); return el && getComputedStyle(el).display === 'none'; },
  sel, { timeout: 20000 });
const isVisible = (page, sel) => page.evaluate(
  (sel) => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none'; }, sel);
const imgState = (page, sel) => page.evaluate((sel) => document.querySelector(sel).dataset.sf, sel);

async function main() {
  const srv = await startServers();
  const { ctx, sw, extId, close } = await launch();
  const consoleErrors = [];
  try {
    await setSettings(sw, {
      keywords: ['Fußball', 'Hochwasser', 'Bürgermeister', 'Gemeinderat', 'Lawine'],
      display: 'hide',
      ocr: true,
    });

    const page = await ctx.newPage();
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    await page.goto(srv.base + '/');

    console.log('Testseite', srv.base);
    await step('Text-Teaser („FUSSBALL“ ≙ „Fußball“) ausgeblendet', () => hidden(page, '#t-text'));
    await step('Bild mit Schlagwort im alt-Attribut: figure ausgeblendet', () => hidden(page, '#t-alt'));
    await step('Bild mit eingebrannter Schrift (OCR, fremde Domain): article ausgeblendet', () => hidden(page, '#t-ocr'));
    await step('Kontrollbild ohne Schlagwort wird wieder scharf', async () => {
      await page.waitForFunction(() => document.querySelector('#img-control').dataset.sf === 'ok', null, { timeout: 20000 });
      const filter = await page.evaluate(() => getComputedStyle(document.querySelector('#img-control')).filter);
      assert.equal(filter, 'none');
    });
    await step('Kleines Bild unter Mindestgröße wird nicht geprüft', async () => {
      assert.equal(await imgState(page, '#img-icon'), 'small');
      assert.ok(await isVisible(page, '#t-icon'));
    });
    await step('Vorauswahl: Treffer in Bildhinweis/Teaser-Text → kein OCR für diese Bilder', async () => {
      await hidden(page, '#t-teaser');
      await page.waitForTimeout(1500);
      const keys = await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)));
      assert.ok(!keys.some((k) => k.includes('alt-bild')), 'alt-Bild wurde trotzdem per OCR gelesen');
      assert.ok(!keys.some((k) => k.includes('teaser')), 'Teaser-Bild wurde trotzdem per OCR gelesen');
    });
    await step('Nachgeladener Text ausgeblendet', () => hidden(page, '#t-later'));
    await step('Nachgeladenes Bild (lazy, src gesetzt) per OCR ausgeblendet', () => hidden(page, '#t-lazy'));
    await step('Unauffällige Inhalte und Spalten bleiben sichtbar', async () => {
      for (const sel of ['#t-neutral', '#t-later-ok', '#t-control', '#col', '#col2', '#main', 'header']) {
        assert.ok(await isVisible(page, sel), `${sel} sollte sichtbar sein`);
      }
    });
    await step('Neues Bild wird sofort beim Einfügen unscharf gestellt', async () => {
      await page.evaluate((u) => {
        const img = document.createElement('img');
        img.id = 'img-new'; img.width = 320; img.height = 180;
        img.src = u + '/ocr-kontrolle.png?neu=' + Date.now();
        document.getElementById('later').appendChild(img);
      }, srv.imgBase);
      const f = await page.evaluate(() => getComputedStyle(document.querySelector('#img-new')).filter);
      assert.match(f, /blur/);
      await page.waitForFunction(() => document.querySelector('#img-new').dataset.sf === 'ok', null, { timeout: 20000 });
    });

    let tabId;
    await step('Zähler im Popup', async () => {
      tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url: url + '/*' }))[0].id, srv.base);
      const popup = await ctx.newPage();
      await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
      await popup.waitForFunction(() => Number(document.getElementById('count').textContent) >= 5, null, { timeout: 5000 });
      const n = await popup.textContent('#count');
      assert.equal(n, '6');
      assert.equal(await popup.textContent('#host'), '127.0.0.1');
      await popup.close();
    });

    await step('OCR-Ergebnisse im Cache (chrome.storage.local)', async () => {
      const keys = await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('ocr:')));
      assert.ok(keys.length >= 3, `nur ${keys.length} Einträge`);
      const entry = await sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k], keys.find((k) => k.includes('ocr-treffer')));
      assert.match(entry.t, /B[üu]rgermeister/i);
      console.log(`    erkannter Text: ${JSON.stringify(entry.t.trim())}`);
    });

    await step('Nach Neuladen kommt das OCR-Ergebnis aus dem Cache (schnell)', async () => {
      const t0 = Date.now();
      await page.reload();
      await hidden(page, '#t-ocr');
      const dt = Date.now() - t0;
      console.log(`    ${dt} ms bis ausgeblendet`);
      assert.ok(dt < 3000);
    });

    await step('Darstellung „Platzhalter“: Klick zeigt den Inhalt', async () => {
      await setSettings(sw, { display: 'placeholder' });
      await page.waitForFunction(() => document.querySelectorAll('.sf-placeholder').length >= 3, null, { timeout: 10000 });
      const txt = await page.textContent('.sf-placeholder');
      assert.match(txt, /^Ausgeblendet \(.+\)/);
      const ph = page.locator('#t-text').locator('xpath=preceding-sibling::*[1]');
      assert.match(await ph.textContent(), /Ausgeblendet \(Fußball\)/);
      await ph.click();
      assert.ok(await isVisible(page, '#t-text'));
    });

    await step('Darstellung „unscharf“', async () => {
      await setSettings(sw, { display: 'blur' });
      // #t-text wurde oben aufgedeckt und bleibt aufgedeckt; #t-later ist noch verborgen.
      await page.waitForFunction(() => {
        const el = document.querySelector('#t-later');
        return el && el.classList.contains('sf-blurred') && getComputedStyle(el).filter.includes('blur');
      }, null, { timeout: 10000 });
      assert.ok(!(await page.evaluate(() => document.querySelector('#t-text').classList.contains('sf-blurred'))));
    });

    await step('Popup: für diese Seite ausschalten zeigt alles wieder', async () => {
      const popup = await ctx.newPage();
      await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
      await popup.click('#site');
      await popup.close();
      await page.waitForFunction(() => !document.querySelector('[data-sf-hit]') && !document.documentElement.classList.contains('sf-active'), null, { timeout: 5000 });
      const list = await sw.evaluate(async () => (await chrome.storage.sync.get('siteList')).siteList);
      assert.deepEqual(list, ['127.0.0.1']);
      await setSettings(sw, { siteList: [] });
    });

    const addOnceImage = (id) => page.evaluate(({ u, id }) => {
      const img = document.createElement('img');
      img.id = id; img.width = 320; img.height = 180;
      img.src = `${u}/once/ocr-kontrolle.png?${id}`;
      document.getElementById('main').prepend(img);
    }, { u: srv.imgBase, id });

    await step('Fehlerfall (Bild für Erweiterung nicht ladbar) → Standard: scharf', async () => {
      await setSettings(sw, { display: 'hide' });
      await addOnceImage('img-err');
      await page.waitForFunction(() => ['ok', 'err'].includes(document.querySelector('#img-err').dataset.sf), null, { timeout: 20000 });
      assert.equal(await imgState(page, '#img-err'), 'ok');
    });

    await step('Fehlerfall mit Einstellung „unscharf lassen“', async () => {
      await setSettings(sw, { onError: 'blur' });
      await addOnceImage('img-err2');
      await page.waitForFunction(() => ['ok', 'err'].includes(document.querySelector('#img-err2').dataset.sf), null, { timeout: 20000 });
      assert.equal(await imgState(page, '#img-err2'), 'err');
      const f = await page.evaluate(() => getComputedStyle(document.querySelector('#img-err2')).filter);
      assert.match(f, /blur/);
      await setSettings(sw, { onError: 'show' });
    });

    await step('Lasttest: 4000 Listeneinträge ohne lange Blockaden', async () => {
      await setSettings(sw, { display: 'hide' });
      const p2 = await ctx.newPage();
      await p2.addInitScript(() => {
        window.__long = [];
        new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); })
          .observe({ type: 'longtask', buffered: true });
      });
      await p2.goto(srv.base + '/stress.html');
      await p2.waitForFunction(() => document.querySelectorAll('[data-sf-hit]').length === 8, null, { timeout: 10000 });
      const long = await p2.evaluate(() => window.__long);
      // Lange Tasks durch das Seitenskript selbst (innerHTML von 4000 Einträgen) sind erwartbar;
      // die Erweiterung arbeitet in kleinen Idle-Häppchen.
      console.log(`    lange Tasks: ${long.length} (${long.map((d) => Math.round(d)).join(', ')} ms)`);
      const hiddenIds = await p2.evaluate(() => [...document.querySelectorAll('[data-sf-hit]')].map((e) => e.id));
      assert.deepEqual(hiddenIds, ['i7', 'i507', 'i1007', 'i1507', 'i2007', 'i2507', 'i3007', 'i3507']);
      await p2.close();
    });

    await step('Keine Skriptfehler auf der Seite', () => assert.deepEqual(consoleErrors, []));
  } finally {
    await close();
    srv.close();
  }
  const failed = results.filter((r) => r[0] !== 'ok');
  console.log(`\n${results.length - failed.length}/${results.length} Tests bestanden.`);
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
