// Playwright-Test für den Bedeutungs-Filter mit einem winzigen Testmodell
// (test/fixtures/tiny-model, erzeugt von test/make_tiny_model.py). Prüft die ganze Kette:
// transformers.js im Offscreen Document → Tokenizer → ONNX → Vektoren → Entscheidung.
import assert from 'node:assert/strict';
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, setSettings } from './e2e.mjs';
import { startServers } from './server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const modelDir = join(here, '..', 'extension', 'vendor', 'models', 'test');

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(true); console.log(`  ✔ ${name}`); }
  catch (e) { results.push(false); console.log(`  ✘ ${name}\n    ${String(e.message || e).split('\n').join('\n    ')}`); }
}
const hidden = (page, sel) => page.waitForFunction(
  (sel) => { const el = document.querySelector(sel); return el && getComputedStyle(el).display === 'none'; }, sel, { timeout: 15000 });
const visible = (page, sel) => page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).display !== 'none', sel);

async function main() {
  mkdirSync(modelDir, { recursive: true });
  cpSync(join(here, 'fixtures', 'tiny-model'), join(modelDir, 'tiny'), { recursive: true });
  const srv = await startServers();
  const { ctx, sw, extId, close } = await launch();
  try {
    await sw.evaluate(() => chrome.storage.local.set({ semModel: 'test/tiny' }));
    await setSettings(sw, {
      keywords: [], presets: ['klima'], display: 'hide', learn: false, revealHold: false,
      semantic: true, semanticLevel: 'mittel',
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('Seitenfehler:', e));

    await step('Einschalten lädt das Modell schon vorab (wie beim Chrome-Start)', async () => {
      await setSettings(sw, { semantic: false });
      await sw.evaluate(() => { semRef = null; });
      await setSettings(sw, { semantic: true });
      await sw.evaluate(async () => {
        for (let i = 0; i < 100 && !semRef; i++) await new Promise((r) => setTimeout(r, 100));
        if (!semRef) throw new Error('Modell/Bezugstexte nicht vorgeladen');
      });
    });

    await step('KI-Teaser mit Bild: Bild wird nicht scharf, bevor die KI über den Teaser entschieden hat', async () => {
      const p = await ctx.newPage();
      // Langsame KI nachstellen (wie auf großen Seiten): jede KI-Anfrage 6 s verzögern.
      await sw.evaluate(() => { globalThis.__semDelay = 6000; });
      await p.addInitScript(() => {
        window.__early = [];
        new MutationObserver((recs) => {
          for (const r of recs) {
            const img = r.target;
            if (img.tagName !== 'IMG' || img.dataset.sf !== 'ok') continue;
            const block = img.closest('article');
            if (!block.dataset.sfHit) window.__early.push(img.id);
          }
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-sf'] });
      });
      await p.goto(srv.base + '/semantik-bild.html');
      await p.waitForFunction(() => document.querySelector('#b-klima').dataset.sfHit === 'Bedeutung', null, { timeout: 20000 });
      await p.waitForFunction(() => document.querySelector('#b-img2').dataset.sf === 'ok', null, { timeout: 20000 });
      await sw.evaluate(() => { globalThis.__semDelay = 0; });
      assert.deepEqual(await p.evaluate(() => window.__early.filter((id) => id === 'b-img')), [], 'Bild des KI-Treffers war vorher scharf');
      await p.close();
    });

    await step('KI: Anfrage mit Vorrang wartet nicht, bis ein großes Paket ohne Vorrang ganz fertig ist', async () => {
      const order = await sw.evaluate(async () => {
        for (let i = 0; i < 200 && (semRunning || semJobs.length); i++) await new Promise((r) => setTimeout(r, 25));
        semCache.clear();
        const big = Array.from({ length: 48 }, (_, i) => `Gemeinde ${i} plant neuen Radweg entlang des Flusses Nummer ${i}`);
        const done = [];
        // Das große Paket muss schon laufen (am Anfang künstlich verzögert), wenn die vorrangige Anfrage kommt.
        globalThis.__semDelay = 1500;
        const a = semScore(big, false).then((r) => done.push('gross ' + r.ok));
        for (let i = 0; i < 400 && semJobs.length; i++) await new Promise((r) => setTimeout(r, 10));
        globalThis.__semDelay = 0;
        const b = semScore(['Ein sichtbarer Teaser, dessen Bild auf die Entscheidung wartet'], true).then((r) => done.push('vorrang ' + r.ok));
        await Promise.all([a, b]);
        return done;
      });
      assert.deepEqual(order, ['vorrang true', 'gross true']);
    });

    await step('Ohne Schlagwort: Klima-Artikel über Themen-Beschreibung erkannt', async () => {
      await page.goto(srv.base + '/semantik.html');
      await hidden(page, '#s-klima');
      assert.equal(await page.evaluate(() => document.querySelector('#s-klima').dataset.sfHit), 'Bedeutung');
    });

    await step('Wohnen, Kultur und Unbekanntes bleiben sichtbar; Krieg (Thema aus) auch', async () => {
      await page.waitForTimeout(800);
      for (const sel of ['#s-wohnen', '#s-kultur', '#s-unbekannt', '#s-krieg']) assert.ok(await visible(page, sel), sel);
    });

    await step('Bewertungen „Krieg“ als unerwünscht → ähnlicher Artikel ohne Schlagwort ausgeblendet', async () => {
      await sw.evaluate(() => importRatings([
        { text: 'Soldaten und Raketen: Krieg geht weiter', label: 'b' },
        { text: 'Panzer und Soldaten an der Front', label: 'b' },
        { text: 'Luftangriffe und Bombardierung', label: 'b' },
        { text: 'Wohnungen und Mieten', label: 'o' },
      ]));
      await page.reload();
      await hidden(page, '#s-krieg');
      await hidden(page, '#s-klima');
      assert.ok(await visible(page, '#s-wohnen'));
      const st = await sw.evaluate(() => semStatus());
      assert.equal(st.installed, true);
      assert.equal(st.indexed, 4);
    });

    await step('Gute Nachricht trotz gesperrtem Thema wird gezeigt, schlechte bleibt unscharf', async () => {
      await setSettings(sw, { semantic: false, presets: ['krieg', 'tod'], positiveShow: true, positiveLevel: 'mittel' });
      await page.reload();
      // Alle drei treffen das Schlagwort „Waffenstillstand*“ (Liste Krieg) …
      await page.waitForFunction(() => document.querySelector('#s-krieg2').dataset.sfHit, null, { timeout: 15000 });
      // … die gute Nachricht wird nach der Ton-Prüfung wieder sichtbar.
      await page.waitForFunction(() => document.querySelector('#s-frieden').dataset.sfPositive !== undefined, null, { timeout: 15000 });
      assert.ok(await visible(page, '#s-frieden'));
      assert.ok(!(await visible(page, '#s-krieg2')), 'schlechte Nachricht sichtbar');
      await page.waitForTimeout(800);
      assert.ok(!(await visible(page, '#s-suizid')), 'Suizid-Erwähnung darf nie aufgedeckt werden');
    });

    await step('Gute Nachricht mit eigenem Schlagwort bleibt unscharf', async () => {
      await setSettings(sw, { keywords: ['Waffenstillstand'] });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#s-frieden').dataset.sfHit, null, { timeout: 15000 });
      await page.waitForTimeout(2500);
      assert.equal(await page.evaluate(() => document.querySelector('#s-frieden').dataset.sfPositive), undefined);
      assert.ok(!(await visible(page, '#s-frieden')), 'eigenes Schlagwort wegen guten Tons aufgedeckt');
      await setSettings(sw, { keywords: [] });
    });

    await step('Ohne die Option bleiben alle Treffer unscharf', async () => {
      await setSettings(sw, { positiveShow: false });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#s-frieden').dataset.sfHit, null, { timeout: 15000 });
      await page.waitForTimeout(800);
      assert.ok(!(await visible(page, '#s-frieden')));
      await setSettings(sw, { semantic: true, presets: ['klima'] });
    });

    await step('KI-Gegenprüfung: harmloser Listen-Treffer wird wieder gezeigt, eigene Schlagwörter nie', async () => {
      await setSettings(sw, { keywords: ['Museum'], presets: ['klima'], semantic: true, semanticVeto: true, positiveShow: false });
      await page.reload();
      // „Konzert und Theater: Musik ist CO2 neutral“ trifft „CO2“ (Liste Klima), liegt aber klar bei „Kultur“ → wieder sichtbar.
      await page.waitForFunction(() => document.querySelector('#s-veto').dataset.sfVeto !== undefined, null, { timeout: 15000 });
      assert.ok(await visible(page, '#s-veto'));
      // „Gletscher schmelzen …“ liegt beim Thema Klima → bleibt unscharf.
      await page.waitForTimeout(500);
      assert.ok(!(await visible(page, '#s-klima')));
      // „Konzert im Museum“ trifft das eigene Schlagwort „Museum“ → bleibt unscharf, obwohl harmlos.
      assert.ok(!(await visible(page, '#s-kultur')), 'eigenes Schlagwort wurde aufgedeckt');
      assert.equal(await page.evaluate(() => document.querySelector('#s-kultur').dataset.sfVeto), undefined);
    });

    await step('Aufdeck-Protokoll: Gegenprüfung deckt auf → Eintrag „automatisch“ mit Wert und Verlauf', async () => {
      await setSettings(sw, { revealLog: true });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#s-veto').dataset.sfVeto !== undefined, null, { timeout: 15000 });
      let e = null;
      for (let i = 0; i < 40 && !e; i++) {
        await page.waitForTimeout(200);
        const log = await sw.evaluate(async () => (await chrome.storage.local.get('revlog')).revlog);
        e = log && log.entries.find((x) => x.kind === 'automatisch' && x.wie === 'gegenpruefung' && /Musik ist CO2/.test(x.text));
      }
      assert.ok(e, 'kein Eintrag');
      assert.equal(e.treffer, 'CO2');
      assert.equal(e.liste, 'klima');
      assert.ok(e.werte.gegenpruefung);
      assert.deepEqual(e.verlauf.map((x) => x.schritt), ['unscharf', 'gegenpruefung']);
      assert.equal(e.verlauf[1].harmlos, true);
      // Eigenes Schlagwort („Museum“) wurde nicht aufgedeckt → kein automatischer Eintrag dazu.
      const log = await sw.evaluate(async () => (await chrome.storage.local.get('revlog')).revlog);
      assert.ok(!log.entries.some((x) => x.kind === 'automatisch' && /Museum/.test(x.text)));
      await setSettings(sw, { revealLog: false });
    });

    await step('Ohne Gegenprüfung bleibt auch der harmlose Treffer unscharf', async () => {
      await setSettings(sw, { semanticVeto: false });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#s-veto').dataset.sfHit, null, { timeout: 15000 });
      await page.waitForTimeout(1000);
      assert.ok(!(await visible(page, '#s-veto')));
      await setSettings(sw, { keywords: [], semanticVeto: true });
    });

    await step('Einstellungsseite zeigt Modellstatus', async () => {
      const opt = await ctx.newPage();
      await opt.goto(`chrome-extension://${extId}/options.html`);
      await opt.waitForFunction(() => /ist installiert/.test(document.getElementById('semStatus').textContent));
      assert.ok(await opt.isChecked('#semantic'));
      await opt.close();
    });

    await step('Modell fehlt → Filter greift nicht, Hinweis in den Einstellungen', async () => {
      await sw.evaluate(() => chrome.storage.local.set({ semModel: 'test/fehlt' }));
      await page.reload();
      await page.waitForTimeout(1500);
      assert.ok(await visible(page, '#s-klima'));
      const opt = await ctx.newPage();
      await opt.goto(`chrome-extension://${extId}/options.html`);
      await opt.waitForFunction(() => /nicht installiert/.test(document.getElementById('semStatus').textContent));
      await opt.close();
    });

    await step('Ausgeschaltet → keine Bedeutungs-Treffer', async () => {
      await sw.evaluate(() => chrome.storage.local.set({ semModel: 'test/tiny' }));
      await setSettings(sw, { semantic: false });
      await page.reload();
      await page.waitForTimeout(1500);
      assert.ok(await visible(page, '#s-klima'));
    });
  } finally {
    await close();
    srv.close();
    rmSync(modelDir, { recursive: true, force: true });
  }
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} Bedeutungs-Tests bestanden.`);
  process.exit(ok === results.length ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
