// Erzeugt die Symbole (16/32/48/128 px) mit Chromium aus einer SVG-Vorlage.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');
mkdirSync(out, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect x="4" y="4" width="120" height="120" rx="26" fill="#3d5afe"/>
  <path d="M24 34h80l-30 36v26l-20 10V70z" fill="#fff"/>
  <path d="M30 104 L98 28" stroke="#ff5252" stroke-width="12" stroke-linecap="round"/>
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
await browser.close();
