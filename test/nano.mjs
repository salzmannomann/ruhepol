// Playwright-Test für „Wünsche in eigenen Worten“ und Chromes eingebautes Modell (Gemini Nano).
// Gemini Nano gibt es im Test-Chromium nicht: Ein Ersatz-„LanguageModel“ mit festen Antworten
// wird in die Einstellungsseite eingespielt; im Offscreen Document lädt die Erweiterung bei
// gesetztem Test-Schalter nanoFake die Datei vendor/test/nano-fake.js (aus test/fixtures).
import assert from 'node:assert/strict';
import { cpSync, mkdirSync } from 'node:fs';
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
const blurred = (page, sel) => page.evaluate((sel) => document.querySelector(sel).classList.contains('sf-blurred'), sel);

/** Ersatz für Chromes LanguageModel: Assistent liefert festen Vorschlag, Urteil nach Stichwort. */
function fakeNano() {
  if (!location.protocol.startsWith('chrome-extension')) return;
  const calls = (globalThis.__nanoCalls = []);
  const session = (system) => ({
    async clone() { return session(system); },
    destroy() {},
    async prompt(text) {
      calls.push(text);
      if (system.includes('Einstellungs-Assistent')) {
        return JSON.stringify({
          addAllow: ['Fußball'], addWishNo: ['Gewalt im Stadion'], enablePresets: ['tierleid', 'gibtsnicht'],
          removeKeywords: ['nichtvorhanden'], antwort: 'Fußball bleibt sichtbar, außer bei Gewalt im Stadion.',
        });
      }
      return JSON.stringify({ urteil: /Konzert/.test(text) ? 'harmlos' : 'belastend' });
    },
  });
  globalThis.LanguageModel = {
    async availability() { return 'available'; },
    async create(opts) { return session(opts.initialPrompts[0].content); },
  };
}

async function main() {
  mkdirSync(modelDir, { recursive: true });
  cpSync(join(here, 'fixtures', 'tiny-model'), join(modelDir, 'tiny'), { recursive: true });
  const testDir = join(here, '..', 'extension', 'vendor', 'test');
  mkdirSync(testDir, { recursive: true });
  cpSync(join(here, 'fixtures', 'nano-fake.js'), join(testDir, 'nano-fake.js'));
  const srv = await startServers();
  const { ctx, sw, extId, close } = await launch();
  await ctx.addInitScript(fakeNano);
  try {
    await sw.evaluate(() => chrome.storage.local.set({ semModel: 'test/tiny', nanoFake: true }));
    await setSettings(sw, {
      keywords: ['Krieg'], presets: ['krieg'], display: 'blur', learn: false, revealHold: false,
      semantic: true, semanticVeto: true, nanoCheck: true, wishNo: [], wishYes: [],
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('Seitenfehler:', e));

    await step('Grenzfall: Chrome-Modell hält „Krieg und Konzert“ für harmlos → wieder scharf', async () => {
      await page.goto(srv.base + '/nano.html');
      await page.waitForFunction(() => document.querySelector('#n-konzert').dataset.sfNano === 'harmlos', null, { timeout: 20000 });
      assert.equal(await blurred(page, '#n-konzert'), false);
    });

    await step('Grenzfall, den das Modell belastend findet, und eindeutiger Treffer bleiben unscharf', async () => {
      await page.waitForTimeout(1500);
      assert.equal(await blurred(page, '#n-theater'), true);
      assert.equal(await blurred(page, '#n-klar'), true);
    });

    await step('Zweite Meinung abgeschaltet → Grenzfall bleibt unscharf', async () => {
      await setSettings(sw, { nanoCheck: false });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#n-konzert').classList.contains('sf-blurred'));
      await page.waitForTimeout(2500);
      assert.equal(await blurred(page, '#n-konzert'), true);
      await setSettings(sw, { nanoCheck: true });
    });

    await step('Wunsch „will ich nicht sehen“ in eigenen Worten → Artikel ohne Schlagwort unscharf', async () => {
      assert.equal(await blurred(page, '#n-wohnen'), false);
      await setSettings(sw, { wishNo: ['Wohnungen und Mieten'] });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#n-wohnen').classList.contains('sf-blurred'), null, { timeout: 15000 });
    });

    await step('Wunsch „will ich trotzdem sehen“ → passender Treffer wird wieder scharf', async () => {
      await setSettings(sw, { wishNo: [], wishYes: ['Krieg und Theater'] });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#n-theater').dataset.sfVeto !== undefined, null, { timeout: 15000 });
      assert.equal(await blurred(page, '#n-theater'), false);
      assert.equal(await blurred(page, '#n-klar'), true);
      await setSettings(sw, { wishYes: [] });
    });

    await step('Einstellungsseite: Wünsche speichern, Status des Chrome-Modells', async () => {
      const opt = await ctx.newPage();
      await opt.goto(`chrome-extension://${extId}/options.html#themen`);
      await opt.waitForFunction(() => /bereit/.test(document.getElementById('nanoStatus').textContent));
      await opt.fill('#wishNo', 'Streit im Wahlkampf');
      await opt.locator('#wishNo').blur();
      await opt.waitForFunction(() => /Gespeichert/.test(document.getElementById('status').textContent));
      const s = await sw.evaluate(() => SFSettings.load());
      assert.deepEqual(s.wishNo, ['Streit im Wahlkampf']);
      await opt.close();
    });

    await step('Assistent: Vorschlag anzeigen (nur gültige Änderungen), Übernehmen setzt sie', async () => {
      const opt = await ctx.newPage();
      await opt.goto(`chrome-extension://${extId}/options.html#themen`);
      await opt.waitForSelector('#assistBox:not([hidden])');
      await opt.fill('#assistInput', 'Fußball soll nie unscharf sein, außer bei Gewalt im Stadion. Und keine Tierquälerei.');
      await opt.click('#assistGo');
      await opt.waitForSelector('#assistPreview:not([hidden])');
      const items = await opt.$$eval('#assistChanges li', (l) => l.map((x) => x.textContent));
      assert.ok(items.some((t) => /Nie ausblenden: „Fußball“/.test(t)), items.join(' | '));
      assert.ok(items.some((t) => /Will ich nicht sehen: „Gewalt im Stadion“/.test(t)));
      assert.ok(items.some((t) => /Listen einschalten: Tierleid/.test(t)), items.join(' | '));
      assert.ok(!items.some((t) => /gibtsnicht|nichtvorhanden/.test(t)), 'ungültige Felder gefiltert');
      await opt.click('#assistApply');
      await opt.waitForFunction(() => /Übernommen/.test(document.getElementById('status').textContent));
      const s = await sw.evaluate(() => SFSettings.load());
      assert.ok(s.allow.includes('Fußball'));
      assert.ok(s.wishNo.includes('Gewalt im Stadion') && s.wishNo.includes('Streit im Wahlkampf'));
      assert.ok(s.presets.includes('tierleid') && s.presets.includes('krieg'));
      assert.equal(await opt.inputValue('#allow'), 'Fußball');
      await opt.close();
    });

    await step('Ohne Chrome-Modell: Assistent verborgen, Hinweis statt Fehler', async () => {
      const opt = await ctx.newPage();
      await opt.addInitScript(() => { delete globalThis.LanguageModel; Object.defineProperty(globalThis, 'LanguageModel', { value: undefined }); });
      await opt.goto(`chrome-extension://${extId}/options.html#themen`);
      await opt.waitForFunction(() => /kein eingebautes Modell/.test(document.getElementById('nanoStatus').textContent));
      assert.equal(await opt.isHidden('#assistBox'), true);
      await opt.close();
    });
  } finally {
    await close();
    srv.close();
  }
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} Tests zu Wünschen und Chrome-Modell bestanden.`);
  process.exit(ok === results.length ? 0 : 1);
}

main();
