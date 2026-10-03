// Lädt das Sprachmodell für den Bedeutungs-Filter (Stufe 2) nach extension/vendor/models/.
// Standard: Xenova/multilingual-e5-small (int8-quantisiert, ca. 120 MB + Tokenizer).
// Aufruf: npm run fetch-model            (vorhandene Dateien werden übersprungen)
//         npm run fetch-model -- --force (neu laden)
import { mkdirSync, existsSync, statSync, createWriteStream, renameSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = process.env.SF_MODEL || 'Xenova/multilingual-e5-small';
// Feste Revision: passt zu den SHA-256-Prüfsummen unten, auch wenn das Repo sich ändert.
const REVISION = process.env.SF_MODEL ? 'main' : '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
const base = `https://huggingface.co/${model}/resolve/${REVISION}`;
const dir = join(root, 'extension', 'vendor', 'models', model);
const force = process.argv.includes('--force');

// [Datei, Mindestgröße in Bytes, SHA-256 (nur für das Standardmodell)] – schützt vor
// abgebrochenen oder veränderten Downloads. Die Prüfsummen entsprechen den Angaben von
// Hugging Face (X-Linked-ETag) für Revision 761b726.
const pinned = model === 'Xenova/multilingual-e5-small';
const files = [
  ['config.json', 100],
  ['tokenizer.json', 1_000_000, pinned && '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39'],
  ['tokenizer_config.json', 50],
  ['special_tokens_map.json', 20],
  ['onnx/model_quantized.onnx', 50_000_000, pinned && 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193'],
];

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

for (const [name, min, hash] of files) {
  const target = join(dir, name);
  if (!force && existsSync(target) && statSync(target).size >= min && (!hash || (await sha256(target)) === hash)) {
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
  if (hash && (await sha256(tmp)) !== hash) {
    console.error(`${name}: Prüfsumme stimmt nicht – Download verworfen.`);
    process.exit(1);
  }
  renameSync(tmp, target);
  console.log(`geladen   ${name} (${(size / 1e6).toFixed(1)} MB)`);
}
console.log(`Modell liegt in extension/vendor/models/${model}`);
