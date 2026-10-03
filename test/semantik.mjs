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

    await step('Ohne die Option bleiben alle Treffer unscharf', async () => {
      await setSettings(sw, { positiveShow: false });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#s-frieden').dataset.sfHit, null, { timeout: 15000 });
      await page.waitForTimeout(800);
      assert.ok(!(await visible(page, '#s-frieden')));
      await setSettings(sw, { semantic: true, presets: ['klima'] });
    });

    await step('KI-Gegenprüfung: harmloser Schlagwort-Treffer wird wieder gezeigt', async () => {
      await setSettings(sw, { keywords: ['Museum', 'Gletscher'], presets: ['klima'], semantic: true, semanticVeto: true, positiveShow: false });
      await page.reload();
      // „Konzert im Museum“ trifft das Schlagwort, liegt aber klar bei „Kultur“ → wieder sichtbar.
      await page.waitForFunction(() => document.querySelector('#s-kultur').dataset.sfVeto !== undefined, null, { timeout: 15000 });
      assert.ok(await visible(page, '#s-kultur'));
      // „Gletscher schmelzen …“ trifft ebenfalls, liegt aber beim Thema Klima → bleibt unscharf.
      await page.waitForTimeout(500);
      assert.ok(!(await visible(page, '#s-klima')));
    });

    await step('Ohne Gegenprüfung bleibt auch der harmlose Treffer unscharf', async () => {
      await setSettings(sw, { semanticVeto: false });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#s-kultur').dataset.sfHit, null, { timeout: 15000 });
      await page.waitForTimeout(1000);
      assert.ok(!(await visible(page, '#s-kultur')));
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
