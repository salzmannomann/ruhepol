// Playwright-Tests: Aufdeck-Protokoll (aus = nichts, an = Aufdecken, Bewertung, selbst
// ausgeblendet, nachträglich unscharf, Zähler, Export, Löschen).
import assert from 'node:assert/strict';
import { launch, setSettings } from './e2e.mjs';
import { startServers } from './server.mjs';

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(true); console.log(`  ✔ ${name}`); }
  catch (e) { results.push(false); console.log(`  ✘ ${name}\n    ${String(e.message || e).split('\n').join('\n    ')}`); }
}

const readLog = (sw) => sw.evaluate(async () => (await chrome.storage.local.get('revlog')).revlog || { entries: [], stats: {} });

async function waitLog(sw, pred, ms = 8000) {
  const end = Date.now() + ms;
  let log;
  while (Date.now() < end) {
    log = await readLog(sw);
    if (pred(log)) return log;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Protokoll erreicht den erwarteten Stand nicht: ' + JSON.stringify(log).slice(0, 600));
}

async function main() {
  const srv = await startServers();
  const { ctx, sw, extId, close } = await launch();
  try {
    await setSettings(sw, {
      keywords: ['Lawine'], presets: [], display: 'blur', learn: false, revealHold: false, revealLog: false,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('Seitenfehler:', e));
    const tabId = async () => sw.evaluate(async (url) => (await chrome.tabs.query({ url: url + '/*' }))[0].id, srv.base);

    await step('Ausgeschaltet (Standard): Aufdecken wird nicht mitgeschrieben', async () => {
      assert.equal((await sw.evaluate(async () => (await chrome.storage.sync.get('revealLog')).revealLog)), false);
      await page.goto(srv.base + '/protokoll.html');
      await page.waitForFunction(() => document.querySelector('#p-lawine').classList.contains('sf-blurred'), null, { timeout: 10000 });
      await page.click('#p-lawine h2');
      await page.waitForFunction(() => !document.querySelector('#p-lawine').classList.contains('sf-blurred'));
      await page.waitForTimeout(2600);
      assert.equal((await readLog(sw)).entries.length, 0);
    });

    await step('Eingeschaltet: Aufdecken mit Grund, Text, Seitenaufbau, Einstellungen; 👍 hängt die Bewertung an', async () => {
      await setSettings(sw, { revealLog: true });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#p-lawine').classList.contains('sf-blurred'), null, { timeout: 10000 });
      await page.click('#p-lawine h2');
      await page.click('.sf-overlay button[aria-label^="Ja"]');
      const log = await waitLog(sw, (l) => l.entries.some((e) => e.kind === 'aufgedeckt' && e.bewertung));
      const e = log.entries.find((x) => x.kind === 'aufgedeckt');
      assert.equal(e.treffer, 'Lawine');
      assert.equal(e.liste, 'eigene');
      assert.equal(e.grund, 'text');
      assert.equal(e.wie, 'geklickt');
      assert.equal(e.bewertung, 'zeigen');
      assert.equal(e.rolle, 'teaser');
      assert.equal(e.medium, 'text');
      assert.match(e.text, /Lawine im Zillertal/);
      assert.equal(e.url, srv.base + '/protokoll.html');
      assert.ok(e.verlauf.some((s) => s.schritt === 'unscharf' && s.treffer === 'Lawine'), JSON.stringify(e.verlauf));
      assert.match(e.dom.path, /main > article#p-lawine\.teaser\.gross$/);
      assert.doesNotMatch(e.dom.html, /<script|var x/);
      assert.match(e.dom.html, /href="\/lawine"/); // Link ohne Parameter
      assert.equal(e.cfg.eigene, 1);
      assert.ok(e.version);
      const key = Object.keys(log.stats).find((k) => k.endsWith(' 127.0.0.1'));
      assert.ok(key, JSON.stringify(log.stats));
      assert.equal(log.stats[key].seiten, 1);
      assert.equal(log.stats[key].treffer.eigene, 1);
      assert.equal(log.stats[key].aufgedeckt.eigene, 1);
    });

    await step('Rechtsklick „Ausblenden“ auf Sichtbares → „selbst ausgeblendet“', async () => {
      await page.click('#p-harmlos h2', { button: 'right' });
      await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'ctx', action: 'block' }), await tabId());
      const log = await waitLog(sw, (l) => l.entries.some((e) => e.kind === 'selbst-ausgeblendet'));
      const e = log.entries.find((x) => x.kind === 'selbst-ausgeblendet');
      assert.match(e.text, /Konzertabend/);
      assert.equal(e.treffer, '');
    });

    await step('Bild schon scharf zu sehen, Treffer kommt danach → „spät unscharf“ mit Dauer', async () => {
      await page.waitForFunction(() => document.querySelector('#p-img').dataset.sf === 'ok', null, { timeout: 15000 });
      await page.waitForTimeout(300);
      await page.evaluate(() => { document.querySelector('#p-spaet-h').textContent = 'Lawine am Arlberg'; });
      const log = await waitLog(sw, (l) => l.entries.some((e) => e.kind === 'spaet'));
      const e = log.entries.find((x) => x.kind === 'spaet');
      assert.equal(e.treffer, 'Lawine');
      assert.equal(e.medium, 'text+bild');
      assert.ok(e.scharfSeitMs >= 300, String(e.scharfSeitMs));
    });

    await step('Einstellungen: Export enthält Einträge, Zähler und Einstellungen; Löschen leert das Protokoll', async () => {
      const opt = await ctx.newPage();
      opt.on('pageerror', (e) => console.log('Fehler in den Einstellungen:', e));
      opt.on('console', (m) => { if (m.type() === 'error') console.log('Konsole:', m.text()); });
      await opt.goto(`chrome-extension://${extId}/options.html#erweitert`);
      await opt.waitForFunction(() => document.querySelector('#revealLog').checked && /Einträge/.test(document.querySelector('#logInfo').textContent));
      // Download-Ereignisse kommen bei Erweiterungsseiten nicht an: Link-Klick abfangen und die Datei lesen.
      await opt.evaluate(() => {
        URL.revokeObjectURL = () => {};
        HTMLAnchorElement.prototype.click = function () { window.__dl = { name: this.download, href: this.href }; };
      });
      await opt.click('#logExport');
      await opt.waitForFunction(() => window.__dl);
      const dl = await opt.evaluate(async () => ({ name: window.__dl.name, text: await (await fetch(window.__dl.href)).text() }));
      assert.match(dl.name, /^ruhepol-protokoll-\d{4}-\d{2}-\d{2}\.json$/);
      const json = JSON.parse(dl.text);
      assert.equal(json.format, 'ruhepol-protokoll');
      assert.ok(json.eintraege.length >= 3, String(json.eintraege.length));
      assert.equal(json.einstellungen.revealLog, true);
      assert.ok(Object.keys(json.zaehler).length >= 1);
      // Beim Chrome-Start: Einträge über 30 Tage fallen weg, auch wenn das Protokoll aus ist.
      await sw.evaluate(async () => {
        const l = (await chrome.storage.local.get('revlog')).revlog;
        l.entries.unshift({ kind: 'aufgedeckt', id: 'uralt', t: Date.now() - 40 * 864e5 });
        await chrome.storage.local.set({ revlog: l });
        await chrome.storage.sync.set({ revealLog: false });
        await revlogPruneStale();
      });
      assert.ok(!(await readLog(sw)).entries.some((e) => e.id === 'uralt'));
      opt.once('dialog', (d) => d.accept());
      await opt.click('#logClear');
      await opt.waitForFunction(() => document.querySelector('#logInfo').textContent === 'leer');
      assert.equal((await readLog(sw)).entries.length, 0);
      await opt.close();
    });

  } finally {
    await close();
    srv.close();
  }
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} Protokoll-Tests bestanden.`);
  if (ok !== results.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
