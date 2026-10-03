// Kopiert tesseract.js (Haupt-Bibliothek, Worker, WASM-Core) aus node_modules
// nach extension/vendor/. Nur die LSTM-Varianten des Cores werden gebraucht,
// weil tessdata_fast reine LSTM-Modelle enthält.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const vendor = join(root, 'extension', 'vendor');

const files = [
  ['tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'],
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['tesseract.js/LICENSE.md', 'LICENSE-tesseract.js.md'],
  ['tesseract.js-core/LICENSE', 'LICENSE-tesseract.js-core.txt'],
];

for (const [src, dst] of files) {
  const from = join(nm, src);
  if (!existsSync(from)) {
    if (src.includes('LICENSE')) continue;
    console.error(`Fehlt: ${from} – bitte zuerst "npm install" ausführen.`);
    process.exit(1);
  }
  const to = join(vendor, dst);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`kopiert  ${src}  ->  extension/vendor/${dst}`);
}
