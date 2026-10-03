// Praxistest gegen https://orf.at (braucht Internetzugang).
// Aufruf: npm run test:orf          (sichtbares Fenster: HEADED=1 npm run test:orf)
// Ergebnis: Konsolenbericht + Screenshots in test-results/.
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, setSettings } from './e2e.mjs';

const url = process.argv[2] || 'https://orf.at/';
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-results');
mkdirSync(outDir, { recursive: true });

const { ctx, sw, close } = await launch();
try {
  await setSettings(sw, { keywords: [], presets: ['ki', 'klima', 'krieg', 'terror'], display: 'placeholder' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); })
      .observe({ type: 'longtask', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log(`geladen (DOMContentLoaded) nach ${Date.now() - t0} ms`);

  // Herunterscrollen, damit Lazy-Bilder nachladen und OCR anläuft.
  for (let y = 0; y < 8; y++) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(8000);

  const report = await page.evaluate(() => {
    const hits = [...document.querySelectorAll('[data-sf-hit]')];
    const imgs = [...document.images];
    const by = (s) => imgs.filter((i) => i.dataset.sf === s).length;
    return {
      hidden: hits.length,
      labels: hits.slice(0, 40).map((h) => `${h.tagName.toLowerCase()} ← ${h.dataset.sfHit}: ${(h.innerText || h.getAttribute('alt') || '').trim().slice(0, 70).replace(/\s+/g, ' ')}`),
      images: { total: imgs.length, small: by('small'), ok: by('ok'), hit: by('hit'), pending: by('pending'), wait: by('wait'), err: by('err') },
      longTasks: window.__long,
      bodyHidden: document.body.classList.contains('sf-hidden') || !!document.querySelector('main[data-sf-hit], body[data-sf-hit]'),
    };
  });
  console.log(`ausgeblendete Blöcke: ${report.hidden}`);
  for (const l of report.labels) console.log('  ' + l);
  console.log('Bilder:', report.images);
  console.log('lange Tasks (ms):', report.longTasks.join(', ') || 'keine');
  console.log('ganze Seite/Spalte ausgeblendet?', report.bodyHidden ? 'JA – Fehler!' : 'nein');
  const cache = await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('ocr:')).length);
  console.log(`OCR-Ergebnisse im Cache: ${cache}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(outDir, 'orf-oben.png') });
  await page.screenshot({ path: join(outDir, 'orf-ganz.png'), fullPage: true });
  console.log(`Screenshots: ${outDir}`);
} finally {
  await close();
}
