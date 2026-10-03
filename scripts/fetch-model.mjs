// Lädt das Sprachmodell für den Bedeutungs-Filter (Stufe 2) nach extension/vendor/models/.
// Standard: Xenova/multilingual-e5-small (int8-quantisiert, ca. 120 MB + Tokenizer).
// Aufruf: npm run fetch-model            (vorhandene Dateien werden übersprungen)
//         npm run fetch-model -- --force (neu laden)
import { mkdirSync, existsSync, statSync, createWriteStream, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = process.env.SF_MODEL || 'Xenova/multilingual-e5-small';
const base = `https://huggingface.co/${model}/resolve/main`;
const dir = join(root, 'extension', 'vendor', 'models', model);
const force = process.argv.includes('--force');

// [Datei, Mindestgröße in Bytes] – schützt vor abgebrochenen Downloads.
const files = [
  ['config.json', 100],
  ['tokenizer.json', 1_000_000],
  ['tokenizer_config.json', 50],
  ['special_tokens_map.json', 20],
  ['onnx/model_quantized.onnx', 50_000_000],
];

for (const [name, min] of files) {
  const target = join(dir, name);
  if (!force && existsSync(target) && statSync(target).size >= min) {
    console.log(`vorhanden ${name}`);
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  const res = await fetch(`${base}/${name}`);
  if (!res.ok || !res.body) {
    console.error(`Download fehlgeschlagen (${res.status}): ${base}/${name}`);
    process.exit(1);
  }
  const tmp = target + '.part';
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  const size = statSync(tmp).size;
  if (size < min) {
    console.error(`${name} ist unvollständig (${size} Bytes).`);
    process.exit(1);
  }
  renameSync(tmp, target);
  console.log(`geladen   ${name} (${(size / 1e6).toFixed(1)} MB)`);
}
console.log(`Modell liegt in extension/vendor/models/${model}`);
