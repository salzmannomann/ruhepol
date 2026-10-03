/*
 * Sprachmodell für den Bedeutungs-Filter in einem eigenen Worker-Thread. So blockiert das
 * Rechnen (bis zu einigen Sekunden je Paket) nicht das Offscreen Document, das parallel die
 * Bilder für die Texterkennung vorbereitet. Lädt transformers.js und das Modell ausschließlich
 * aus dem Erweiterungspaket (vendor/transformers, vendor/models); Downloads sind abgeschaltet.
 */
import { env, pipeline } from './vendor/transformers/transformers.min.js';

const base = new URL('./', self.location.href).href; // chrome-extension://…/ (kein chrome.* im Worker)
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = base + 'vendor/models/';
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = base + 'vendor/transformers/';
// Mehrere Threads bräuchten eine cross-origin-isolierte Seite; ein Thread reicht für Teaser.
env.backends.onnx.wasm.numThreads = 1;

let extractor = null; // { model, promise }

function getExtractor(model) {
  if (!extractor || extractor.model !== model) {
    if (extractor) extractor.promise.then((e) => e.dispose && e.dispose()).catch(() => {});
    const promise = pipeline('feature-extraction', model, { dtype: 'q8', device: 'wasm' });
    extractor = { model, promise };
    promise.catch(() => { if (extractor && extractor.promise === promise) extractor = null; });
  }
  return extractor.promise;
}

async function embed(model, texts, prefix) {
  const ex = await getExtractor(model);
  const out = await ex(texts.map((t) => (prefix || '') + t), { pooling: 'mean', normalize: true });
  // Auf 4 Nachkommastellen runden: kleinere Nachrichten, ohne messbaren Genauigkeitsverlust.
  return out.tolist().map((v) => v.map((x) => Math.round(x * 1e4) / 1e4));
}

self.onmessage = ({ data }) => {
  embed(data.model, data.texts, data.prefix)
    .then((vectors) => self.postMessage({ id: data.id, ok: true, vectors }))
    .catch((e) => self.postMessage({ id: data.id, ok: false, error: String((e && e.message) || e) }));
};
