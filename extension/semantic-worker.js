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
// Mehrere Threads: Die Erweiterungsseiten sind cross-origin-isoliert (manifest.json, COOP/COEP).
// Gemessen an 844 echten Teasern (4 Kerne): 1 Thread 80 s, 2 Threads 47 s, 4 Threads 30 s, gleiche
// Ergebnisse. Aber die KI rechnet vor allem, während eine Seite lädt – dann nahmen die Threads der
// Seite und der Texterkennung die Kerne weg (4 Kerne, 3 Threads: Blockierzeit der Seiten +35 %).
// Deshalb nur so viele Threads, wie neben Seite (2 Kerne) und Texterkennung (offscreen.js) frei sind.
const cores = navigator.hardwareConcurrency || 4;
const ocrWorkers = Math.max(2, Math.min(4, Math.floor(cores / 2))); // wie WORKER_COUNT in offscreen.js
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, Math.max(1, cores - ocrWorkers - 2)) : 1;

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
