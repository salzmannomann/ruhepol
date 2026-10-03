/*
 * Offscreen Document, Teil 2: Brücke zum Sprachmodell (semantic-worker.js). Das Modell rechnet
 * in einem eigenen Thread, damit die Bildvorbereitung für die Texterkennung nicht wartet.
 * Nach 15 Minuten ohne Arbeit wird der Worker beendet und gibt den Speicher frei.
 */
const IDLE_UNLOAD_MS = 15 * 60 * 1000; // Laden dauert ca. 5 s: zwischen zwei Nachrichtenseiten behalten

let worker = null;
let idleTimer = null;
let nextId = 1;
const pending = new Map(); // id -> { resolve, reject }

function getWorker() {
  if (!worker) {
    worker = new Worker('semantic-worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.ok) p.resolve(data.vectors); else p.reject(new Error(data.error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Sprachmodell abgestürzt'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

function scheduleUnload() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size) return scheduleUnload();
    if (worker) worker.terminate();
    worker = null;
  }, IDLE_UNLOAD_MS);
}

function embed(model, texts, prefix) {
  clearTimeout(idleTimer);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, model, texts, prefix });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'embed') return false;
  embed(msg.model, msg.texts, msg.prefix)
    .then((vectors) => sendResponse({ ok: true, vectors }))
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }))
    .finally(scheduleUnload);
  return true;
});
