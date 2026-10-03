// Playwright-Test für den Lernfilter (Bewertungen, Rechtsklick, Nie-ausblenden-Liste).
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch, setSettings } from './e2e.mjs';
import { startServers } from './server.mjs';

const SEED = [
  ['Klimakrise: Gletscher in den Alpen schmelzen dramatisch, CO2-Ausstoß steigt', 'b'],
  ['Hitzesommer und Dürre: Klimakrise trifft die Landwirtschaft, Gletscher schrumpfen', 'b'],
  ['UNO-Bericht: Erwärmung beschleunigt sich, CO2 auf Rekordniveau, Eis schmilzt', 'b'],
  ['Klimakrise: Meeresspiegel steigt, Gletscher und Eis verschwinden', 'b'],
  ['Forscher: Hitzesommer werden häufiger, CO2-Ausstoß muss sinken', 'b'],
  ['Klimakrise bedroht Skigebiete, Gletscher verlieren Masse', 'b'],
  ['Wohnungskrise: Mieten in Graz steigen, Familien suchen Wohnungen', 'o'],
  ['Neue Wohnbauförderung soll Wohnungskrise lindern und Mieten senken', 'o'],
  ['Wohnungskrise: Gemeinde baut 2000 leistbare Wohnungen', 'o'],
  ['Mieten steigen weiter – was gegen die Wohnungskrise hilft', 'o'],
  ['Wohnungen für junge Familien: Stadt startet Programm gegen Wohnungskrise', 'o'],
  ['Leistbare Wohnungen gesucht: Wohnungskrise in Innsbruck', 'o'],
].map(([text, label]) => ({ text, label }));

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(true); console.log(`  ✔ ${name}`); }
  catch (e) { results.push(false); console.log(`  ✘ ${name}\n    ${String(e.message || e).split('\n').join('\n    ')}`); }
}
const hidden = (page, sel) => page.waitForFunction(
  (sel) => { const el = document.querySelector(sel); return el && getComputedStyle(el).display === 'none'; }, sel, { timeout: 10000 });
const visible = (page, sel) => page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).display !== 'none', sel);
const ratings = (sw) => sw.evaluate(async () => (await chrome.storage.local.get('ratings')).ratings || []);

async function main() {
  const srv = await startServers();
  const { ctx, sw, extId, close } = await launch();
  try {
    await setSettings(sw, { keywords: ['*krise'], presets: [], display: 'placeholder', learn: true, learnHide: true });
    const page = await ctx.newPage();

    await step('Ohne Bewertungen: nur Schlagwörter zählen', async () => {
      await page.goto(srv.base + '/lernen.html');
      await hidden(page, '#l-klima');
      await hidden(page, '#l-wohnen');
      assert.ok(await visible(page, '#l-gletscher'));
    });

    await step('„Nie ausblenden“: Wohnungskrise bleibt sichtbar', async () => {
      await setSettings(sw, { allow: ['Wohnungskrise'] });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#l-wohnen')).display !== 'none', null, { timeout: 5000 });
      await hidden(page, '#l-klima');
      await setSettings(sw, { allow: [] });
      await hidden(page, '#l-wohnen');
    });

    await step('Bewertungen importieren (12 Stück) → Modell einsatzbereit', async () => {
      // Nachrichten vom Service Worker an sich selbst gehen nicht; Funktion direkt aufrufen.
      await sw.evaluate((list) => importRatings(list), SEED);
      const info = await sw.evaluate(() => learnInfo());
      assert.equal(info.total, 12);
      assert.ok(info.ready);
      assert.ok(info.top.b.some((w) => w.word === 'klimakrise' || w.word === 'gletscher'), JSON.stringify(info.top.b));
    });

    await step('Gelernt: Wohnungskrise sichtbar, Klimakrise weg, Gletscher-Artikel ohne Schlagwort weg', async () => {
      await page.reload();
      await hidden(page, '#l-klima');
      await hidden(page, '#l-gletscher');
      await page.waitForTimeout(500);
      assert.ok(await visible(page, '#l-wohnen'), 'Wohnungskrise sollte sichtbar sein');
      assert.ok(await page.evaluate(() => document.querySelector('#l-wohnen').dataset.sfLearnOk !== undefined));
      const reason = await page.evaluate(() => document.querySelector('#l-gletscher').dataset.sfHit);
      assert.match(reason, /^gelernt, \d+ %$/);
      for (const sel of ['#l-museum', '#l-konzert']) assert.ok(await visible(page, sel), sel);
      await hidden(page, '#l-regierung'); // unbekannte Krise: Schlagwort entscheidet
    });

    await step('Platzhalter-Knopf „Will ich sehen“: zeigt an und merkt', async () => {
      const before = (await ratings(sw)).length;
      const ph = page.locator('#l-regierung').locator('xpath=preceding-sibling::*[1]');
      await ph.locator('button', { hasText: 'Will ich sehen' }).click();
      assert.ok(await visible(page, '#l-regierung'));
      await page.waitForFunction(async () => true);
      await new Promise((r) => setTimeout(r, 300));
      const after = await ratings(sw);
      assert.equal(after.length, before + 1);
      const last = after[after.length - 1];
      assert.equal(last.label, 'o');
      assert.match(last.text, /Regierungskrise in Italien/);
      assert.equal(last.host, '127.0.0.1');
    });

    await step('Platzhalter-Knopf „Passt so“: merkt als ausblenden', async () => {
      const ph = page.locator('#l-klima').locator('xpath=preceding-sibling::*[1]');
      await ph.locator('button', { hasText: 'Passt so' }).click();
      await new Promise((r) => setTimeout(r, 300));
      const last = (await ratings(sw)).at(-1);
      assert.equal(last.label, 'b');
      assert.match(last.text, /Klimakrise: Gletscher schmelzen/);
      assert.match(await ph.textContent(), /gemerkt/);
      assert.ok(!(await visible(page, '#l-klima')), 'bleibt ausgeblendet');
    });

    let tabId;
    await step('Rechtsklick „Will ich nicht sehen“: blendet Artikel aus und merkt', async () => {
      tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url: url + '/*' }))[0].id, srv.base);
      await page.click('#l-museum h2', { button: 'right' });
      await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'ctx', action: 'block' }), tabId);
      await hidden(page, '#l-museum');
      assert.equal(await page.evaluate(() => document.querySelector('#l-museum').dataset.sfHit), 'von dir ausgeblendet');
      const last = (await ratings(sw)).at(-1);
      assert.equal(last.label, 'b');
      assert.match(last.text, /Museum/);
    });

    await step('Rechtsklick „Will ich sehen“ auf Platzhalter: zeigt an und merkt', async () => {
      await page.click('#l-museum >> xpath=preceding-sibling::*[1]', { button: 'right', position: { x: 5, y: 5 } });
      await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'ctx', action: 'ok' }), tabId);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#l-museum')).display !== 'none', null, { timeout: 5000 });
      const last = (await ratings(sw)).at(-1);
      assert.equal(last.label, 'o');
      assert.match(last.text, /Museum/);
    });

    await step('Einstellungsseite: Status, Wörter, Bewertung löschen', async () => {
      const opt = await ctx.newPage();
      await opt.goto(`chrome-extension://${extId}/options.html`);
      await opt.waitForFunction(() => /Lernfilter ist aktiv/.test(document.getElementById('learnStatus').textContent));
      const topB = await opt.textContent('#topB');
      assert.match(topB, /klimakrise|gletscher/);
      const n = (await ratings(sw)).length;
      await opt.click('summary:has-text("Letzte Bewertungen")');
      await opt.locator('#recent li button').first().click();
      await opt.waitForFunction((n) => document.querySelectorAll('#recent li').length === Math.min(40, n - 1), n);
      assert.equal((await ratings(sw)).length, n - 1);
      await opt.close();
    });

    await step('Sync: eigene Bewertungen landen (gekürzt) in chrome.storage.sync', async () => {
      await page.waitForTimeout(5000); // Push ist um 4 s verzögert
      const sync = await sw.evaluate(() => chrome.storage.sync.get(null));
      const rows = Object.keys(sync).filter((k) => /^ratings\d+$/.test(k)).flatMap((k) => sync[k]);
      const local = await ratings(sw);
      assert.equal(rows.length, local.length);
      assert.ok(rows.every((r) => r[4].length <= 280));
      assert.ok(Array.isArray(sync.ratingsDeleted) && sync.ratingsDeleted.length === 1, 'gelöschte Bewertung als Grabstein');
      assert.ok(JSON.stringify(sync).length < 100 * 1024);
    });

    await step('Sync: Bewertung von anderem Gerät wird übernommen', async () => {
      await sw.evaluate(() => chrome.storage.sync.set({ ratings99: [['fremd1', Date.now(), 'b', 'macbook', 'Bewertung vom MacBook: Hochwasser in Kärnten']] }));
      await page.waitForFunction(() => true);
      let found = false;
      for (let i = 0; i < 20 && !found; i++) {
        found = (await ratings(sw)).some((r) => r.id === 'fremd1');
        if (!found) await new Promise((r) => setTimeout(r, 200));
      }
      assert.ok(found, 'fremde Bewertung nicht übernommen');
    });

    await step('Kontextmenü ist registriert', async () => {
      // contextMenus hat keine Leseschnittstelle; erneutes Anlegen mit gleicher ID muss scheitern.
      const err = await sw.evaluate(() => new Promise((res) => {
        chrome.contextMenus.create({ id: 'sf-block', title: 'x' }, () => res(chrome.runtime.lastError ? chrome.runtime.lastError.message : ''));
      }));
      assert.match(err, /duplicate|Cannot create item with duplicate id/i);
    });
  } finally {
    await close();
    srv.close();
  }
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} Lernfilter-Tests bestanden.`);
  process.exit(ok === results.length ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
