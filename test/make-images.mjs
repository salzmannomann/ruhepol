// Erzeugt Testbilder mit eingebrannter deutscher Schrift (Canvas in Chromium).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(out, { recursive: true });

const images = [
  // Datei, Text, Hintergrund-Farben
  ['ocr-treffer.png', ['Bürgermeister', 'tritt überraschend zurück'], ['#1e3c72', '#2a5298']],
  ['ocr-kontrolle.png', ['Sonniges Wetter', 'am Wochenende'], ['#f7971e', '#ffd200']],
  ['ocr-nachgeladen.png', ['Streit im Gemeinderat', 'über neue Straße'], ['#134e5e', '#71b280']],
  ['alt-bild.png', ['', ''], ['#8e9eab', '#eef2f3']],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, lines, colors] of images) {
  const dataUrl = await page.evaluate(({ lines, colors }) => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 640, 360);
    grad.addColorStop(0, colors[0]); grad.addColorStop(1, colors[1]);
    g.fillStyle = grad; g.fillRect(0, 0, 640, 360);
    // etwas "Foto"-Struktur
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,255,255,${0.04 + (i % 5) * 0.01})`;
      g.beginPath(); g.arc((i * 97) % 640, (i * 53) % 360, 20 + (i % 7) * 8, 0, Math.PI * 2); g.fill();
    }
    if (lines[0]) {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, 210, 640, 130);
      g.fillStyle = '#fff';
      g.font = 'bold 44px "DejaVu Sans", Arial, sans-serif';
      g.fillText(lines[0], 24, 262);
      g.font = '32px "DejaVu Sans", Arial, sans-serif';
      g.fillText(lines[1], 24, 314);
    }
    return c.toDataURL('image/png');
  }, { lines, colors });
  writeFileSync(join(out, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(file);
}
await browser.close();
