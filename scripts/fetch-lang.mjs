// Lädt die Sprachdaten (tessdata_fast: deu, eng) nach extension/vendor/lang/.
// Bereits vorhandene Dateien werden übersprungen (mit --force neu laden).
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'extension', 'vendor', 'lang');
const base = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main';
const force = process.argv.includes('--force');

mkdirSync(dir, { recursive: true });
for (const lang of ['deu', 'eng']) {
  const target = join(dir, `${lang}.traineddata`);
  if (!force && existsSync(target) && statSync(target).size > 100000) {
    console.log(`vorhanden ${lang}.traineddata`);
    continue;
  }
  const res = await fetch(`${base}/${lang}.traineddata`);
  if (!res.ok) {
    console.error(`Download fehlgeschlagen (${res.status}): ${lang}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(target, buf);
  console.log(`geladen   ${lang}.traineddata (${(buf.length / 1e6).toFixed(1)} MB)`);
}
