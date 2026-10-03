/*
 * Offscreen Document, Teil 2: lokales Sprachmodell für den Bedeutungs-Filter.
 * Lädt transformers.js und das Modell ausschließlich aus dem Erweiterungspaket
 * (vendor/transformers, vendor/models); Downloads aus dem Internet sind abgeschaltet.
 */
import { env, pipeline } from './vendor/transformers/transformers.min.js';

const IDLE_UNLOAD_MS = 5 * 60 * 1000;

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('vendor/models/');
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/transformers/');
// Mehrere Threads bräuchten eine cross-origin-isolierte Seite; ein Thread reicht für Teaser.
env.backends.onnx.wasm.numThreads = 1;

let extractor = null; // { model, promise }
let idleTimer = null;

function getExtractor(model) {
  if (!extractor || extractor.model !== model) {
    if (extractor) extractor.promise.then((e) => e.dispose && e.dispose()).catch(() => {});
    const promise = pipeline('feature-extraction', model, { dtype: 'q8', device: 'wasm' });
    extractor = { model, promise };
    promise.catch(() => { if (extractor && extractor.promise === promise) extractor = null; });
  }
  return extractor.promise;
}

function scheduleUnload() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const e = extractor;
    extractor = null;
    if (e) {
      try { (await e.promise).dispose(); } catch (_) { /* egal */ }
    }
  }, IDLE_UNLOAD_MS);
}

async function embed(model, texts, prefix) {
  clearTimeout(idleTimer);
  const ex = await getExtractor(model);
  const out = await ex(texts.map((t) => (prefix || '') + t), { pooling: 'mean', normalize: true });
  // Auf 4 Nachkommastellen runden: kleinere Nachrichten, ohne messbaren Genauigkeitsverlust.
  return out.tolist().map((v) => v.map((x) => Math.round(x * 1e4) / 1e4));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'embed') return false;
  embed(msg.model, msg.texts, msg.prefix)
    .then((vectors) => sendResponse({ ok: true, vectors }))
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }))
    .finally(scheduleUnload);
  return true;
});
