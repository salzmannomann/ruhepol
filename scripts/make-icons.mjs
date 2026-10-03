// Erzeugt die Symbole (16/32/48/128 px) und icon.svg mit Chromium aus einer SVG-Vorlage.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');
mkdirSync(out, { recursive: true });

// Ruhepol: Sonne über einer ruhigen Welle, Verlauf Blau → Türkis.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3D7BD9"/><stop offset="1" stop-color="#36C2B4"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="30" fill="url(#g)"/>
  <circle cx="64" cy="54" r="26" fill="#fff" opacity=".45" filter="url(#glow)"/>
  <circle cx="64" cy="54" r="18" fill="#fff"/>
  <path d="M22 86 C37 77 50 77 64 86 S91 95 106 86" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  const png = await page.screenshot({ omitBackground: true });
  writeFileSync(join(out, `icon${size}.png`), png);
  console.log(`icon${size}.png`);
}
writeFileSync(join(out, 'icon.svg'), svg);
await browser.close();
