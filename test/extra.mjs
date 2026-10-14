// Playwright-Tests: Hintergrundbilder, Video-Poster, Shadow-DOM, Gedrückthalten, gesperrte Bereiche.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launch, setSettings } from './e2e.mjs';
import { startServers } from './server.mjs';

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(true); console.log(`  ✔ ${name}`); }
  catch (e) { results.push(false); console.log(`  ✘ ${name}\n    ${String(e.message || e).split('\n').join('\n    ')}`); }
}
const hidden = (page, sel) => page.waitForFunction(
  (sel) => { const el = document.querySelector(sel); return el && getComputedStyle(el).display === 'none'; }, sel, { timeout: 20000 });
const visible = (page, sel) => page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).display !== 'none', sel);
const shadow = (page, fn, arg) => page.evaluate(({ fn, arg }) => {
  const root = document.querySelector('x-card').shadowRoot;
  return new Function('root', 'arg', fn)(root, arg);
}, { fn, arg });

async function main() {
  const srv = await startServers();
  const { ctx, sw, extId, close } = await launch();
  try {
    await setSettings(sw, {
      keywords: ['Bürgermeister', 'Gemeinderat', 'Lawine'], presets: [], display: 'hide', learn: false,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('Seitenfehler:', e));
    await page.goto(srv.base + '/extra.html');

    await step('CSS-Hintergrundbild mit Schrift (OCR) → Teaser ausgeblendet', () => hidden(page, '#x-bg'));
    await step('CSS-Hintergrundbild ohne Treffer wird geprüft und bleibt sichtbar', async () => {
      await page.waitForFunction(() => document.querySelector('#bg-ok').dataset.sfBg === 'ok', null, { timeout: 20000 });
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#bg-ok')).filter), 'none');
    });
    await step('Agenturfoto mit Schlagwortliste als alt-Text: Liste zählt nicht als Bildhinweis', async () => {
      await page.waitForFunction(() => document.querySelector('#tags-pic').dataset.sf === 'ok', null, { timeout: 20000 });
      assert.ok(await visible(page, '#x-tags'));
    });
    await step('Video-Vorschaubild (poster) mit Schrift → Beitrag ausgeblendet', () => hidden(page, '#x-video'));

    await step('Unschärfe überall gleich stark (14 px), nie doppelt: vorsorglich, Prüfung, Treffer, Shadow-DOM', async () => {
      const r = await page.evaluate(() => {
        const f = (el) => getComputedStyle(el).filter;
        const box = document.createElement('section');
        // Bild in Prüfung allein, in vorsorglich unscharfem und in unscharfem Block, verschachtelte Blöcke
        box.innerHTML = '<img id="u-img" data-sf="pending" width="300" height="200">' +
          '<article id="u-pre" class="sf-pre"><img id="u-pre-img" data-sf="pending" width="300" height="200"><div id="u-pre-bg" data-sf-bg="pending"></div></article>' +
          '<article id="u-hit" class="sf-blurred"><p class="sf-pre" id="u-hit-pre">x</p><img id="u-hit-img" data-sf="pending" width="300" height="200"></article>';
        document.body.append(box);
        const host = document.querySelector('x-card').shadowRoot;
        const sbox = document.createElement('div');
        sbox.innerHTML = '<img id="su-img" data-sf="pending" width="300" height="200"><article id="su-hit" class="sf-blurred"><img id="su-hit-img" data-sf="pending" width="300" height="200"></article>';
        host.append(sbox);
        const out = {};
        for (const id of ['u-img', 'u-pre', 'u-pre-img', 'u-pre-bg', 'u-hit', 'u-hit-pre', 'u-hit-img']) out[id] = f(document.getElementById(id));
        for (const id of ['su-img', 'su-hit', 'su-hit-img']) out[id] = f(host.getElementById(id));
        box.remove(); sbox.remove();
        return out;
      });
      assert.deepEqual(r, {
        'u-img': 'blur(14px)', 'u-pre': 'blur(14px)', 'u-hit': 'blur(14px)', // eine Stärke für alles
        'u-pre-img': 'none', 'u-pre-bg': 'none', 'u-hit-pre': 'none', 'u-hit-img': 'none', // nicht doppelt
        'su-img': 'blur(14px)', 'su-hit': 'blur(14px)', 'su-hit-img': 'none',
      });
    });

    await step('Winziger Rahmen (Werbung): Ruhepol startet erst, wenn er sichtbar groß wird', async () => {
      const p = await ctx.newPage();
      await p.goto(srv.base + '/rahmen.html');
      // normal großer Rahmen: wie immer gefiltert
      await p.waitForFunction(() => {
        const d = document.querySelector('#gross').contentDocument;
        return d && d.querySelector('#t') && getComputedStyle(d.querySelector('#t')).display === 'none';
      }, null, { timeout: 10000 });
      await p.waitForTimeout(500);
      assert.equal(await p.evaluate(() => document.querySelector('#klein').contentDocument.documentElement.classList.contains('sf-active')), false,
        'Ruhepol läuft schon im winzigen Rahmen');
      // wird er groß, greift der Filter
      await p.evaluate(() => { const f = document.querySelector('#klein'); f.width = 400; f.height = 200; });
      await p.waitForFunction(() => {
        const d = document.querySelector('#klein').contentDocument;
        return getComputedStyle(d.querySelector('#t')).display === 'none' && getComputedStyle(d.querySelector('#ok')).display !== 'none';
      }, null, { timeout: 10000 });
      await p.close();
    });

    await step('Shadow-DOM: Text-Treffer ausgeblendet, Rest sichtbar', async () => {
      await page.waitForFunction(() => {
        const r = document.querySelector('x-card').shadowRoot;
        return getComputedStyle(r.querySelector('#s-text')).display === 'none';
      }, null, { timeout: 10000 });
      assert.equal(await shadow(page, "return getComputedStyle(root.querySelector('#s-ok')).display"), 'block');
    });
    await step('Shadow-DOM: Bild mit Schrift per OCR ausgeblendet', async () => {
      await page.waitForFunction(() => {
        const r = document.querySelector('x-card').shadowRoot;
        return getComputedStyle(r.querySelector('#s-img')).display === 'none';
      }, null, { timeout: 20000 });
    });
    await step('Shadow-DOM: nachgeladener Inhalt wird erkannt', async () => {
      await shadow(page, "const a = document.createElement('article'); a.id = 's-late'; a.innerHTML = '<h2>Neue Lawine</h2>'; root.append(a);");
      await page.waitForFunction(() => {
        const el = document.querySelector('x-card').shadowRoot.querySelector('#s-late');
        return el && getComputedStyle(el).display === 'none';
      }, null, { timeout: 5000 });
    });

    await step('Gedrückthalten (Standard): Ladekreis in der Mitte des Blocks, 2 s halten zeigt an', async () => {
      assert.equal(await sw.evaluate(async () => (await chrome.storage.sync.get('revealHold')).revealHold), true, 'nicht Standard');
      await setSettings(sw, { display: 'blur' });
      await page.waitForFunction(() => document.querySelector('#x-hold').classList.contains('sf-blurred'));
      // Kurzer Klick: bleibt unscharf, Hinweis, keine Auswahl-Leiste.
      await page.click('#x-hold');
      await page.waitForTimeout(300);
      assert.ok(await page.evaluate(() => document.querySelector('#x-hold').classList.contains('sf-blurred')), 'kurzer Klick hat aufgedeckt');
      assert.match(await page.textContent('.sf-toast'), /gedrückt halten/i);
      assert.equal(await page.locator('.sf-overlay').count(), 0);
      // Gedrückt halten (absichtlich am Rand): Kreis erscheint sofort in der Blockmitte und füllt sich.
      const box = await page.locator('#x-hold h2').boundingBox();
      const x = box.x + 20, y = box.y + box.height / 2;
      const blk = await page.locator('#x-hold').boundingBox();
      const cx = blk.x + blk.width / 2, cy = blk.y + blk.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.waitForTimeout(150);
      const pos = await page.evaluate(() => {
        const r = document.querySelector('.sf-holdring').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      assert.ok(Math.abs(pos.x - cx) < 3 && Math.abs(pos.y - cy) < 3, `Kreis nicht in der Blockmitte (${JSON.stringify({ pos, cx, cy })})`);
      assert.ok(Math.abs(pos.x - x) > 50, 'Kreis sitzt unter dem Mauszeiger statt in der Mitte');
      await page.waitForTimeout(850);
      assert.ok(await page.evaluate(() => document.querySelector('#x-hold').classList.contains('sf-blurred')), 'nach 1 s schon offen');
      const offset = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.sf-holdring .sf-ring-fg')).strokeDashoffset.replace('px', '')));
      assert.ok(offset > 15 && offset < 35, `Ladekreis nicht halb gefüllt (${offset})`);
      await page.waitForTimeout(1200);
      await page.mouse.up();
      await page.waitForFunction(() => !document.querySelector('#x-hold').classList.contains('sf-blurred'), null, { timeout: 2000 });
      assert.equal(await page.locator('.sf-holdring').count(), 0);
      assert.match(await page.textContent('.sf-overlay'), /Künftig anzeigen\?/);
      // Wegziehen bricht ab.
      await page.click('.sf-overlay button:has-text("👎")');
      await page.waitForFunction(() => document.querySelector('#x-hold').classList.contains('sf-blurred'));
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 60, y + 10, { steps: 3 });
      await page.waitForTimeout(2300);
      await page.mouse.up();
      assert.ok(await page.evaluate(() => document.querySelector('#x-hold').classList.contains('sf-blurred')), 'Wegziehen hat nicht abgebrochen');
    });

    await step('Link im unscharfen Block: Gedrückthalten zeigt nur an, öffnet den Link nicht', async () => {
      await page.waitForFunction(() => document.querySelector('#x-link').classList.contains('sf-blurred'));
      await page.locator('#x-link').scrollIntoViewIfNeeded();
      const box = await page.locator('#x-link h2').boundingBox();
      await page.mouse.move(box.x + 20, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(2400);
      await page.mouse.up();
      await page.waitForFunction(() => !document.querySelector('#x-link').classList.contains('sf-blurred'));
      await page.waitForTimeout(300);
      assert.notEqual(await page.evaluate(() => location.hash), '#navigiert', 'Link wurde beim Loslassen geöffnet');
      // Danach funktioniert der Link wieder normal.
      await page.click('.sf-overlay button:has-text("×")');
      await page.click('#x-link-a');
      assert.equal(await page.evaluate(() => location.hash), '#navigiert');
      await page.evaluate(() => history.replaceState(null, '', location.pathname));
    });

    await step('Ohne Gedrückthalten: Klick zeigt an, öffnet den Link nicht', async () => {
      await setSettings(sw, { revealHold: false });
      await page.reload(); // aufgedeckte Inhalte bleiben sonst aufgedeckt
      await page.waitForFunction(() => document.querySelector('#x-link').classList.contains('sf-blurred'), null, { timeout: 10000 });
      await page.click('#x-link h2');
      await page.waitForFunction(() => !document.querySelector('#x-link').classList.contains('sf-blurred'));
      await page.waitForTimeout(300);
      assert.notEqual(await page.evaluate(() => location.hash), '#navigiert');
    });

    await step('„Warum?“: ⓘ in der Leiste und Rechtsklick erklären den Grund', async () => {
      // #x-link wurde im Schritt davor per Klick aufgedeckt → Leiste mit ⓘ
      await page.click('.sf-overlay button[aria-label="Warum war das unscharf?"]');
      const why = await page.textContent('.sf-overlay .sf-why');
      assert.match(why, /Schlagwort „Lawine“ aus deiner eigenen Schlagwortliste im Text/);
      await page.click('.sf-overlay button:has-text("×")');
      // Rechtsklick → „Warum unscharf?“ auf einen noch unscharfen Block
      const tid = await sw.evaluate(async (url) => (await chrome.tabs.query({ url: url + '/*' }))[0].id, srv.base);
      await page.locator('#x-hold').scrollIntoViewIfNeeded();
      await page.click('#x-hold h2', { button: 'right' });
      await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'ctx', action: 'why' }), tid);
      await page.waitForFunction(() => /Schlagwort „Lawine“/.test(document.querySelector('.sf-toast')?.textContent || ''), null, { timeout: 3000 });
      // … und auf etwas Sichtbares
      await page.click('#r-ausland h2', { button: 'right' });
      await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'ctx', action: 'why' }), tid);
      await page.waitForFunction(() => /nichts unscharf/.test(document.querySelector('.sf-toast')?.textContent || ''), null, { timeout: 3000 });
    });

    await step('Unruhige Seite (ständige Änderungen): Bild wird trotzdem geprüft und scharf', async () => {
      const p2 = await ctx.newPage();
      await p2.goto(srv.base + '/unruhig.html');
      await p2.waitForFunction(() => document.querySelector('#u-img').dataset.sf === 'ok', null, { timeout: 15000 });
      await p2.close();
    });

    await step('Artikelseite: nur der betroffene Absatz wird unscharf, nicht Foto und Rest', async () => {
      await setSettings(sw, { presets: ['terror', 'unglueck'], display: 'blur' });
      const p2 = await ctx.newPage();
      await p2.goto(srv.base + '/artikel.html');
      await p2.waitForFunction(() => document.querySelector('#a-p3').classList.contains('sf-blurred'), null, { timeout: 10000 });
      await p2.waitForTimeout(800);
      const state = await p2.evaluate(() => ['#a-artikel', '#a-fig', '#a-p1', '#a-p2', '#a-p4']
        .map((s) => [s, document.querySelector(s).classList.contains('sf-blurred')]));
      for (const [sel, blurred] of state) assert.equal(blurred, false, `${sel} unscharf`);
      await p2.close();
      await setSettings(sw, { presets: [] });
    });

    await step('Artikel-Absatz: ein einzelner milder Treffer („Massenentlassungen“) reicht nicht, zwei schon; Teaser bleibt streng', async () => {
      await setSettings(sw, { presets: ['wirtschaft', 'krise'], display: 'blur' });
      const p2 = await ctx.newPage();
      await p2.goto(srv.base + '/artikel.html');
      await p2.waitForFunction(() => document.querySelector('#b-p3').classList.contains('sf-blurred')
        && document.querySelector('#c-teaser').classList.contains('sf-blurred'), null, { timeout: 10000 });
      await p2.waitForTimeout(800);
      assert.equal(await p2.evaluate(() => document.querySelector('#b-p1').classList.contains('sf-blurred')), false, 'Rückblick-Absatz unscharf');
      await p2.close();
      await setSettings(sw, { presets: [] });
    });

    let tabId;
    await step('Bereich sperren: Auswahl, Größer/Kleiner, Sperren', async () => {
      tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url: url + '/*' }))[0].id, srv.base);
      await page.click('#sport-1 h3', { button: 'right' });
      await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'ctx', action: 'zone' }), tabId);
      await page.waitForSelector('.sf-picker');
      assert.ok(await page.evaluate(() => document.querySelector('#r-sport').classList.contains('sf-pick')), 'Rubrik nicht vorgeschlagen');
      assert.match(await page.textContent('.sf-picker'), /„Sport“/);
      await page.click('.sf-picker button:has-text("Größer")');
      assert.ok(await page.evaluate(() => document.querySelector('#ressorts').classList.contains('sf-pick')));
      await page.click('.sf-picker button:has-text("Kleiner")');
      assert.ok(await page.evaluate(() => document.querySelector('#r-sport').classList.contains('sf-pick')));
      await page.click('.sf-picker button:has-text("Sperren")');
      await page.waitForFunction(() => document.querySelector('#r-sport').classList.contains('sf-blurred'), null, { timeout: 5000 });
      assert.ok(!(await page.evaluate(() => document.querySelector('#r-ausland').classList.contains('sf-blurred'))), 'Ausland mitgesperrt');
      assert.equal(await page.locator('.sf-pick').count(), 0);
      const zones = await sw.evaluate(async () => (await chrome.storage.sync.get('zones')).zones);
      // Element hat eine id → Selektor über id, Überschrift nicht nötig (nur zur Anzeige).
      assert.deepEqual(zones, [{ host: '127.0.0.1', sel: '#r-sport', head: '', label: 'Sport' }]);
    });

    await step('Bereich ohne id: Selektor über Klasse + Überschrift', async () => {
      // Gleiche Seite, aber ids entfernen → mehrere div.ressort → Überschrift unterscheidet.
      await page.evaluate(() => { for (const r of document.querySelectorAll('.ressort')) r.removeAttribute('id'); });
      await page.click('.ressort:nth-child(1) .story h3', { button: 'right' });
      await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'ctx', action: 'zone' }), tabId);
      await page.waitForSelector('.sf-picker');
      await page.click('.sf-picker button:has-text("Sperren")');
      await page.waitForFunction(async () => true);
      const zones = await sw.evaluate(async () => {
        for (let i = 0; i < 20; i++) {
          const z = (await chrome.storage.sync.get('zones')).zones;
          if (z.length === 2) return z;
          await new Promise((r) => setTimeout(r, 100));
        }
        return (await chrome.storage.sync.get('zones')).zones;
      });
      assert.deepEqual(zones[1], { host: '127.0.0.1', sel: 'div.ressort', head: 'Ausland', label: 'Ausland' });
      await sw.evaluate(async (z) => chrome.storage.sync.set({ zones: [z] }), zones[0]);
      await page.reload();
    });

    await step('Bereich bleibt nach Neuladen gesperrt; Anzeigen fragt 👍/👎', async () => {
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#r-sport').classList.contains('sf-blurred'), null, { timeout: 5000 });
      await page.click('#r-sport h2');
      await page.waitForFunction(() => !document.querySelector('#r-sport').classList.contains('sf-blurred'));
      assert.match(await page.textContent('.sf-overlay'), /Bereich künftig anzeigen\?/);
      await page.click('.sf-overlay button:has-text("👎")');
      await page.waitForFunction(() => document.querySelector('#r-sport').classList.contains('sf-blurred'));
    });

    await step('Einstellungsseite listet den Bereich; Entfernen hebt die Sperre auf', async () => {
      const opt = await ctx.newPage();
      await opt.goto(`chrome-extension://${extId}/options.html#seiten`);
      await opt.waitForFunction(() => /Sport/.test(document.getElementById('zones').textContent));
      await opt.click('#zones button');
      await opt.waitForFunction(() => /Keine/.test(document.getElementById('zones').textContent));
      await opt.close();
      await page.waitForFunction(() => !document.querySelector('#r-sport').classList.contains('sf-blurred'), null, { timeout: 5000 });
    });

    const isBlurred = (pg, sel) => pg.evaluate((sel) => document.querySelector(sel).classList.contains('sf-blurred'), sel);
    await step('Artikel direkt geöffnet: Treffer im Artikel werden wie gewohnt unscharf', async () => {
      await setSettings(sw, { keywords: ['Bürgermeister', 'Gemeinderat', 'Lawine'], presets: [], display: 'blur', revealHold: false, trustOpened: true, zones: [] });
      const p = await ctx.newPage();
      await p.goto(srv.base + '/artikel2.html');
      await p.waitForFunction(() => document.querySelector('#p2').classList.contains('sf-blurred')
        && document.querySelector('#f1-img').dataset.sf === 'hit', null, { timeout: 20000 });
      await p.close();
    });

    await step('Über sichtbaren Teaser geöffnet: Artikel lesbar, Teaser-Leisten weiter gefiltert', async () => {
      const p = await ctx.newPage();
      await p.goto(srv.base + '/teaser.html');
      await p.waitForFunction(() => document.querySelector('#t-hit').classList.contains('sf-blurred'));
      await Promise.all([p.waitForURL('**/artikel2.html'), p.click('#t-ok a')]);
      await p.waitForFunction(() => document.querySelector('#s1').classList.contains('sf-blurred')
        && document.querySelector('#r1').classList.contains('sf-blurred'), null, { timeout: 10000 });
      await p.waitForTimeout(1500);
      assert.equal(await isBlurred(p, '#p2'), false, 'Absatz im Artikel unscharf');
      assert.equal(await p.evaluate(() => document.querySelector('#f1-img').dataset.sf), 'ok', 'Foto im Artikel geprüft/unscharf');
      await p.close();
    });

    await step('Startseite über „News“-Link geöffnet: Teaser bleiben gefiltert (kein „bewusst geöffneter Artikel“)', async () => {
      const p = await ctx.newPage();
      await p.goto(srv.base + '/start.html');
      await p.waitForFunction(() => document.querySelector('#g1').closest('.sf-blurred'), null, { timeout: 10000 });
      await Promise.all([p.waitForURL('**/start.html?neu'), p.click('#news-link')]);
      await p.waitForFunction(() => document.querySelector('#g1').closest('.sf-blurred'), null, { timeout: 10000 });
      await p.waitForTimeout(1500);
      assert.ok(await p.evaluate(() => !!document.querySelector('#g1').closest('.sf-blurred')), 'Teaser auf der Startseite wieder aufgedeckt');
      await p.close();
    });

    await step('Unscharfer Teaser: erst aufdecken, dann öffnen → Artikel lesbar', async () => {
      const p = await ctx.newPage();
      await p.goto(srv.base + '/teaser.html');
      await p.waitForFunction(() => document.querySelector('#t-hit').classList.contains('sf-blurred'));
      await p.click('#t-hit h2'); // deckt auf (ohne Gedrückthalten), öffnet nicht
      await p.waitForFunction(() => !document.querySelector('#t-hit').classList.contains('sf-blurred'));
      assert.match(p.url(), /teaser\.html/);
      await p.keyboard.press('Escape');
      await Promise.all([p.waitForURL('**/artikel3.html'), p.click('#t-hit a')]);
      await p.waitForFunction(() => document.querySelector('#s1').classList.contains('sf-blurred'), null, { timeout: 10000 });
      await p.waitForTimeout(1000);
      assert.equal(await isBlurred(p, '#p2'), false);
      await p.close();
    });

    await step('Mittelklick (neuer Tab) auf sichtbaren Teaser → Artikel im neuen Tab lesbar', async () => {
      const p = await ctx.newPage();
      await p.goto(srv.base + '/teaser.html');
      await p.waitForFunction(() => document.querySelector('#t-hit').classList.contains('sf-blurred'));
      const [tab] = await Promise.all([ctx.waitForEvent('page'), p.click('#t-mid a', { button: 'middle' })]);
      await tab.waitForLoadState('domcontentloaded');
      await tab.waitForFunction(() => document.querySelector('#s1') && document.querySelector('#s1').classList.contains('sf-blurred'), null, { timeout: 10000 });
      await tab.waitForTimeout(1000);
      assert.equal(await isBlurred(tab, '#p2'), false);
      await tab.close();
      await p.close();
    });

    await step('Schalter aus → auch über Teaser geöffnete Artikel werden gefiltert', async () => {
      await setSettings(sw, { trustOpened: false });
      const p = await ctx.newPage();
      await p.goto(srv.base + '/teaser.html');
      await Promise.all([p.waitForURL('**/artikel2.html'), p.click('#t-ok a')]);
      await p.waitForFunction(() => document.querySelector('#p2').classList.contains('sf-blurred'), null, { timeout: 10000 });
      await p.close();
      await setSettings(sw, { trustOpened: true, revealHold: true });
    });

    await step('Kaltstart: Bildprüfungen kurz nach dem Start gehen nicht verloren', async () => {
      const res = await sw.evaluate(async () => {
        await chrome.offscreen.closeDocument().catch(() => {});
        offscreenReady = null;
        const c = new OffscreenCanvas(200, 60);
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 60); g.fillStyle = '#000'; g.font = '28px sans-serif';
        const urls = [];
        for (let i = 0; i < 24; i++) {
          g.fillRect(190, 0, 2 + i, 2); // jedes Bild etwas anders
          urls.push(await blobToDataUrl(await c.convertToBlob({ type: 'image/png' })));
        }
        // gestaffelt: einige Aufträge kommen, während das Dokument schon existiert, aber noch lädt
        return Promise.all(urls.map((d, i) => new Promise((r) => setTimeout(r, i * 15)).then(() => runJob(null, d))));
      });
      const bad = res.filter((r) => !r.ok);
      assert.equal(bad.length, 0, JSON.stringify(bad));
    });

    await step('Großes Bild (1200 × 800) wird schnell gelesen: kein langsamer BMP-Umweg in tesseract.js', async () => {
      const res = await sw.evaluate(async () => {
        await ensureOffscreen();
        const make = async (i) => {
          const c = new OffscreenCanvas(1200, 800);
          const g = c.getContext('2d');
          const gr = g.createLinearGradient(0, 0, 1200, 800);
          gr.addColorStop(0, '#dfe9f3'); gr.addColorStop(1, '#ffffff');
          g.fillStyle = gr; g.fillRect(0, 0, 1200, 800);
          g.fillStyle = '#123'; g.font = 'bold 64px sans-serif';
          g.fillText('Sonniges Wetter', 80, 360); g.fillText('am Wochenende', 80, 450);
          g.fillRect(1100, 700, 10 + i, 10); // jedes Bild etwas anders
          return blobToDataUrl(await c.convertToBlob({ type: 'image/png' }));
        };
        await runJob(null, await make(99)); // Worker aufwärmen
        const out = [];
        for (let i = 0; i < 5; i++) {
          const d = await make(i);
          const t = performance.now();
          const r = await runJob(null, d);
          out.push({ ms: performance.now() - t, text: r.text });
        }
        return out;
      });
      for (const r of res) assert.equal(r.text, 'Sonniges Wetter\nam Wochenende');
      // Testrechner: mit BMP rund 1250 ms je Bild, mit PPM rund 300 ms
      const median = res.map((r) => r.ms).sort((a, b) => a - b)[2];
      assert.ok(median < 700, `Median ${Math.round(median)} ms`);
    });

    await step('Bildprüfung antwortet, ohne aufs Speichern im Cache zu warten', async () => {
      const r = await sw.evaluate(async (url) => {
        // Langsamen Speicher nachstellen: jedes Schreiben eines OCR-Ergebnisses dauert 3 s.
        const orig = chrome.storage.local.set.bind(chrome.storage.local);
        chrome.storage.local.set = (items) => Object.keys(items).some((k) => k.startsWith('ocr'))
          ? new Promise((res) => setTimeout(res, 3000)).then(() => orig(items)) : orig(items);
        try {
          await ensureOffscreen();
          const t = performance.now();
          const res = await requestOcr(url);
          const ms = performance.now() - t;
          // Gleiche Adresse während des Speicherns: kein zweiter OCR-Lauf
          const again = await requestOcr(url);
          return { ms, text: res.text, again: again.text };
        } finally { chrome.storage.local.set = orig; }
      }, srv.imgBase + '/ocr-kontrolle.png?speichern=' + Date.now());
      assert.equal(r.text, 'Sonniges Wetter\nam Wochenende');
      assert.equal(r.again, r.text);
      assert.ok(r.ms < 2500, `Antwort nach ${Math.round(r.ms)} ms`);
    });

    await step('Bedienoberfläche: Knöpfe, Menüpunkte und Fußzeile bleiben sichtbar, Inhalte nicht', async () => {
      await setSettings(sw, { keywords: [], presets: ['krieg', 'terror', 'ki', 'klima', 'unglueck', 'krankheit', 'wirtschaft'], display: 'blur', learn: false, ocr: false });
      const p = await ctx.newPage();
      await p.goto(srv.base + '/oberflaeche.html');
      await p.waitForFunction(() => document.querySelector('#std-teaser').closest('[data-sf-hit]'), null, { timeout: 10000 });
      await p.waitForTimeout(500);
      const state = await p.evaluate(() => Object.fromEntries(
        ['nav-krieg', 'nav-terror', 'nav-teaser', 'eil', 'ressort', 'alle', 'rufus', 'rufus-panel', 'prime', 'btn-ki', 'btn-kimodus', 'std-teaser', 'video', 'ticker', 'themen', 'chip', 'kurz-meldung', 'leserbrief', 'kurz-teaser', 'credit', 'caption', 'foto-label', 'ok-teaser', 'promo']
          .map((id) => { const el = document.getElementById(id); return [id, !!(el.closest('[data-sf-hit]') || el.querySelector('[data-sf-hit]'))]; })));
      assert.deepEqual(state, {
        'nav-krieg': false, 'nav-terror': false, // Menüpunkte
        'nav-teaser': true, // Teaser im Menü (ganzer Satz)
        alle: false, rufus: false, 'rufus-panel': false, prime: false, // amazon.de: Leiste mit eingeklapptem Chatfenster („Rufus AI …“)
        eil: true, // Eilmeldung im Seitenkopf: Link auf eine Meldung
        ressort: true, // Überschrift im Seitenkopf
        'btn-ki': false, 'btn-kimodus': false, // Knöpfe
        'std-teaser': true, // <header> im Artikel gehört zum Inhalt
        video: true, // orf.at: Video-Titel als <a role="button"> in einer Überschrift
        ticker: true, // Treffer nur im eingeklappten Text (orf.at-Ticker): ganze Meldung, nicht nur der Absatz
        themen: false, chip: false, // Links auf Themenseiten (kleinezeitung, heute.at)
        'kurz-meldung': true, // kurzer Link auf eine Meldung (tagesschau.de: …-102.html)
        leserbrief: true, // Kennung aus Buchstaben und Ziffern (krone.at: /das-freie-wort/6ac98…)
        'kurz-teaser': true, // Kurz-Teaser mit Artikelnummer (heute.at)
        credit: false, // Bildquelle „© Foto: … Amt Klimaneutrale Stadt“ ist keine Meldung (nextroom.at)
        caption: true, // Bildunterschrift vor der Quellenangabe zählt weiter
        'foto-label': true, // „Foto: …“ als Beschriftung zählt weiter
        'ok-teaser': false,
        promo: false, // kurzer Hinweis in der Fußzeile der Seite
      });
      // Vorsorgliche Unschärfe beim Laden (sf-pre) bleibt nirgends hängen – auch nicht bei
      // Menüpunkten, die danach als Bedienoberfläche freigegeben werden.
      assert.equal(await p.evaluate(() => document.querySelectorAll('.sf-pre').length), 0);
      await p.close();
    });

    await step('Spät angelegte, verschachtelte Shadow-Bereiche (wie MSN) werden geprüft', async () => {
      await setSettings(sw, { keywords: ['Lawine'], presets: [], display: 'blur', learn: false });
      const p = await ctx.newPage();
      await p.goto(srv.base + '/shadow-spaet.html');
      const state = () => p.evaluate(() => {
        const feed = document.querySelector('x-feed').shadowRoot;
        if (!feed) return null;
        const card = (id) => feed.getElementById(id).shadowRoot.querySelector('article');
        return { bad: card('bad').classList.contains('sf-blurred'), ok: card('ok').classList.contains('sf-blurred') };
      }).catch(() => null);
      let s = null;
      for (let i = 0; i < 40 && !(s && s.bad); i++) { await p.waitForTimeout(250); s = await state(); }
      assert.deepEqual(s, { bad: true, ok: false });
      await p.close();
    });

    await step('Nicht-Nachrichtenseite: Bilder sofort scharf, Bild mit Treffer danach unscharf; Nachrichtenseite wie bisher', async () => {
      await setSettings(sw, { keywords: ['Bürgermeister'], presets: [], display: 'blur', learn: false, ocr: true, calmImages: true, siteKinds: { '127.0.0.1': 'calm' }, semantic: false });
      const p = await ctx.newPage();
      // Zustand jedes Bildes beim ersten Prüfschritt (wait/pending) festhalten: Unschärfe ja/nein.
      // Beobachtet ab Seitenstart, damit eine schnelle Prüfung nicht verpasst wird.
      await p.addInitScript(() => {
        window.__seen = {};
        new MutationObserver((recs) => {
          for (const r of recs) {
            const img = r.target;
            if (!img.id || window.__seen[img.id] || !(img.dataset.sf === 'wait' || img.dataset.sf === 'pending')) continue;
            window.__seen[img.id] = getComputedStyle(img).filter;
          }
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-sf'] });
      });
      const watch = async () => {
        await p.waitForFunction(() => window.__seen['ok-img'] && window.__seen['hit-img'], null, { timeout: 20000 });
        return p.evaluate(() => ({ 'ok-img': window.__seen['ok-img'], 'hit-img': window.__seen['hit-img'] }));
      };
      await p.goto(srv.base + '/shop.html');
      const calm = await watch();
      assert.deepEqual(calm, { 'ok-img': 'none', 'hit-img': 'none' }, 'während der Prüfung unscharf');
      await p.waitForFunction(() => document.getElementById('p-hit').classList.contains('sf-blurred'), null, { timeout: 20000 });
      await p.waitForFunction(() => document.getElementById('ok-img').dataset.sf === 'ok', null, { timeout: 20000 });
      assert.ok(!(await p.evaluate(() => document.getElementById('p-ok').closest('[data-sf-hit]'))), 'harmloses Angebot getroffen');
      // Gleiche Seite als Nachrichtenseite eingestuft: Bilder bis zur Prüfung unscharf.
      await setSettings(sw, { siteKinds: {} });
      await p.goto(srv.base + '/shop.html?news');
      const news = await watch();
      assert.match(news['ok-img'], /blur/);
      // Popup zeigt die Einstufung und schaltet um.
      const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url && t.url.includes(u)).id, '/shop.html?news');
      const pop = await ctx.newPage();
      await pop.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
      await pop.waitForFunction(() => document.getElementById('kindInfo').textContent.length > 0, null, { timeout: 5000 });
      assert.equal(await pop.isChecked('#kind'), true);
      await pop.click('#kind');
      await pop.waitForFunction(() => /Keine Nachrichtenseite/.test(document.getElementById('kindInfo').textContent));
      assert.deepEqual(await sw.evaluate(async () => (await chrome.storage.sync.get('siteKinds')).siteKinds), { '127.0.0.1': 'calm' });
      await pop.close();
      await setSettings(sw, { siteKinds: {} });
      await p.close();
    });

    await step('Automatisch: unbekannte Seite ohne Treffer wird still eingestuft; ein Treffer nimmt es zurück; mit Treffer nie', async () => {
      await setSettings(sw, { keywords: ['Bürgermeister'], presets: [], display: 'blur', learn: false, ocr: true, calmImages: true, siteKinds: {}, semantic: false, zones: [], allow: [] });
      // Andere offene Tabs derselben Adresse mit Treffern würden die Einstufung (richtig) zurücknehmen.
      for (const pg of ctx.pages()) if (pg.url().startsWith(srv.base)) await pg.close();
      const seed = () => sw.evaluate(async () => { await chrome.storage.local.remove('autoKinds'); await chrome.storage.local.set({ siteStats: { '127.0.0.1': { pages: 2, imgOk: 29, hits: 0, t: 1 } } }); });
      const auto = () => sw.evaluate(async () => ((await chrome.storage.local.get('autoKinds')).autoKinds || {})['127.0.0.1']);
      // Seite mit Treffer: wird nicht umgestellt.
      await seed();
      const withHit = await ctx.newPage();
      await withHit.goto(srv.base + '/shop.html?auto');
      await withHit.waitForTimeout(13500);
      assert.equal(await auto(), undefined, 'Seite mit Treffer wurde eingestuft');
      await withHit.close();
      // Dritter Aufruf ohne Treffer: still eingestuft, keine Frage, Bilder ab dann sofort sichtbar.
      await seed();
      const p = await ctx.newPage();
      await p.goto(srv.base + '/shop2.html');
      await p.waitForFunction(() => document.documentElement.classList.contains('sf-calm'), null, { timeout: 20000 });
      assert.equal(await auto(), 'calm');
      assert.equal(await p.locator('.sf-feedback').count(), 0, 'es wurde etwas eingeblendet');
      // Popup zeigt die automatische Einstufung.
      const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url && t.url.includes(u)).id, '/shop2.html');
      const pop = await ctx.newPage();
      await pop.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
      await pop.waitForFunction(() => /Automatisch erkannt/.test(document.getElementById('kindInfo').textContent), null, { timeout: 5000 }).catch(async (e) => {
        throw new Error('Popup: ' + JSON.stringify(await pop.evaluate(async () => ({ info: document.getElementById('kindInfo').textContent, host: document.getElementById('host').textContent, ak: await chrome.storage.local.get('autoKinds'), sk: (await chrome.storage.sync.get(['siteKinds', 'calmImages', 'enabled'])) }))) + ' Seite: ' + await p.evaluate(() => document.documentElement.className + ' Treffer: ' + JSON.stringify([...document.querySelectorAll('[data-sf-hit]')].map((e) => [e.dataset.sfHit, e.dataset.sfWhy, e.tagName]))));
      });
      assert.equal(await pop.isChecked('#kind'), false, 'Popup: Schalter „Nachrichtenseite“ an');
      await pop.close();
      // Treffer auf der eingestuften Seite: sofort wieder Nachrichtenseite, dauerhaft.
      await p.goto(srv.base + '/shop.html?zurueck');
      await p.waitForFunction(() => document.getElementById('p-hit').classList.contains('sf-blurred'), null, { timeout: 20000 });
      await p.waitForFunction(() => !document.documentElement.classList.contains('sf-calm'), null, { timeout: 5000 });
      assert.equal(await auto(), 'news');
      await p.goto(srv.base + '/shop2.html?danach');
      await p.waitForTimeout(1000);
      assert.equal(await p.evaluate(() => document.documentElement.classList.contains('sf-calm')), false, 'nach Rücknahme wieder still eingestuft');
      await sw.evaluate(async () => chrome.storage.local.remove(['siteStats', 'autoKinds']));
      await p.close();
    });

    await step('Kennenlernen: öffnet sich bei der Installation; Antworten → Themenauswahl und Stufe', async () => {
      let p = ctx.pages().find((x) => x.url().includes('kennenlernen.html'));
      if (!p) p = await ctx.waitForEvent('page', { predicate: (x) => x.url().includes('kennenlernen.html'), timeout: 5000 });
      await p.waitForLoadState();
      await p.click('#start');
      const qs = await p.evaluate(() => SFOnboarding.questions());
      // Grenzfälle okay → keine Stufen-Frage
      for (const q of qs) await p.click(q.topic === null ? '#ansNo' : '#ansYes');
      assert.ok(!(await p.isVisible('#levelRow')), 'Stufe ohne Anlass angeboten');
      assert.equal(await p.$$eval('#topics input:checked', (l) => l.length), 15);
      await p.click('#again');
      for (const q of qs) {
        assert.equal(await p.textContent('#headline'), q.text);
        if (q.topic === 'krieg' || q.topic === 'terror' || q.topic === null) await p.click('#ansYes');
        else if (q.topic === 'tod') await p.click('#dunno');
        else await p.click('#ansNo');
      }
      assert.ok(await p.isVisible('#summary'));
      assert.ok(await p.isVisible('#levelRow'), 'Grenzfälle belastend → Stufe anbieten');
      const checked = await p.$$eval('#topics input:checked', (l) => l.map((c) => c.value));
      assert.deepEqual(checked.sort(), ['krieg', 'terror', 'tod']);
      await p.uncheck('#topics input[value="tod"]');
      await p.click('#apply');
      await p.waitForSelector('#done.active');
      const st = await sw.evaluate(async () => chrome.storage.sync.get(['presets', 'semanticLevel']));
      assert.deepEqual(st.presets, ['krieg', 'terror']);
      assert.equal(st.semanticLevel, 'stark');
      await p.close();
    });
  } finally {
    await close();
    srv.close();
  }
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} Zusatztests bestanden.`);
  process.exit(ok === results.length ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
