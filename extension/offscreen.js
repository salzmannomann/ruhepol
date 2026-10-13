/*
 * Offscreen Document: hält die tesseract.js-Worker und erkennt Text in Bildern.
 * Alle Dateien (Worker, WASM-Core, Sprachdaten) kommen aus dem Erweiterungspaket.
 */
'use strict';

// Je zweiter Prozessorkern ein Worker, mindestens 2, höchstens 4 (je ca. 30–40 MB Speicher).
const WORKER_COUNT = Math.max(2, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
// Nachrichtenfotos (meist 600–1000 px) nicht vergrößern: kostet viel Rechenzeit, bringt bei
// Schrift in Teaserbildern nichts. Nur wirklich kleine Bilder werden vergrößert.
const MAX_SIDE = 1200;
const UPSCALE_BELOW = 500;
const MAX_UPSCALE = 2;
const IDLE_TERMINATE_MS = 5 * 60 * 1000;

const base = chrome.runtime.getURL('vendor/');
let schedulerPromise = null;
let idleTimer = null;

function getScheduler() {
  if (!schedulerPromise) {
    schedulerPromise = (async () => {
      const scheduler = Tesseract.createScheduler();
      const workers = await Promise.all(
        Array.from({ length: WORKER_COUNT }, () =>
          Tesseract.createWorker(['deu', 'eng'], Tesseract.OEM.LSTM_ONLY, {
            workerPath: base + 'worker.min.js',
            corePath: base + 'core/',
            langPath: base + 'lang',
            gzip: false,
            cacheMethod: 'none',
            workerBlobURL: false,
          })
        )
      );
      for (const w of workers) {
        await w.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
        scheduler.addWorker(w);
      }
      return scheduler;
    })().catch((e) => {
      schedulerPromise = null;
      throw e;
    });
  }
  return schedulerPromise;
}

function touchIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const p = schedulerPromise;
    schedulerPromise = null;
    if (p) {
      try { (await p).terminate(); } catch (_) { /* egal */ }
    }
  }, IDLE_TERMINATE_MS);
}

async function decode(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  try {
    return await createImageBitmap(blob);
  } catch (_) {
    // z. B. SVG: über ein <img> dekodieren
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Skaliert so, dass die lange Seite höchstens MAX_SIDE px hat; kleine Bilder werden vergrößert. */
async function prepare(dataUrl) {
  const src = await decode(dataUrl);
  const w = src.naturalWidth || src.width;
  const h = src.naturalHeight || src.height;
  if (!w || !h) throw new Error('Bild ohne Größe');
  const long = Math.max(w, h);
  let scale = 1;
  if (long > MAX_SIDE) scale = MAX_SIDE / long;
  else if (long < UPSCALE_BELOW) scale = Math.min(MAX_UPSCALE, MAX_SIDE / long);
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparente Flächen weiß, sonst wird schwarze Schrift unsichtbar
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, cw, ch);
  if (src.close) src.close();
  return canvas;
}

// Nur Wörter übernehmen, bei denen Tesseract ziemlich sicher ist. Fotos ohne Schrift
// (Rasen, Laub, Stoff …) liefern sonst Buchstabensalat, der Schlagwort- und KI-Prüfung stört.
const MIN_WORD_CONF = 70;

function cleanWords(tsv) {
  const lines = new Map();
  for (const row of String(tsv || '').split('\n')) {
    const c = row.split('\t');
    if (c.length < 12 || c[0] !== '5') continue; // Ebene 5 = Wort
    const conf = Number(c[10]);
    const word = c.slice(11).join('\t').trim();
    if (!word || conf < MIN_WORD_CONF) continue;
    const letters = (word.match(/\p{L}/gu) || []).length;
    if (letters < 2 || letters / word.length < 0.6) continue; // Zeichenmüll wie „‘<“, „=“
    const key = `${c[2]}.${c[3]}.${c[4]}`; // Block.Absatz.Zeile
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(word);
  }
  return [...lines.values()].map((w) => w.join(' ')).join('\n');
}

/**
 * Canvas als unkomprimiertes PPM-Bild (Kopfzeile + rohe RGB-Werte), das Tesseract (Leptonica)
 * direkt liest. Tesseract bekäme sonst das Canvas selbst und würde es per canvas.toBlob()
 * umwandeln – das dauert im Offscreen Document jedes Mal genau 1 s (Chrome erledigt es erst bei
 * Leerlauf, den diese unsichtbare Seite nie meldet). Bis 1.30.2 war es ein BMP: Das schickt
 * tesseract.js aber durch einen sehr langsamen Umweg in JavaScript (jedes Byte einzeln in ein
 * Objekt kopiert, dann neu kodiert), der rund die Hälfte der Zeit je Bild kostete.
 */
function canvasToPpm(canvas) {
  const w = canvas.width, h = canvas.height;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  // Kommentarzeile als Polster: tesseract.js sucht in den ersten 500 Bytes nach einer
  // EXIF-Drehangabe und könnte sie sonst zufällig in den Bildpunkten finden.
  const head = new TextEncoder().encode(`P6\n#${' '.repeat(500)}\n${w} ${h}\n255\n`);
  const out = new Uint8Array(head.length + w * h * 3);
  out.set(head);
  for (let i = 0, o = head.length, n = w * h * 4; i < n; i += 4) {
    out[o++] = px[i];
    out[o++] = px[i + 1];
    out[o++] = px[i + 2];
  }
  return out;
}

async function recognize(dataUrl) {
  clearTimeout(idleTimer);
  const scheduler = await getScheduler();
  const ppm = canvasToPpm(await prepare(dataUrl));
  const { data } = await scheduler.addJob('recognize', ppm, {}, { text: false, tsv: true });
  return cleanWords(data.tsv);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'recognize') return false;
  recognize(msg.dataUrl)
    .then((text) => sendResponse({ ok: true, text }))
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }))
    .finally(touchIdle);
  return true;
});

/* ---------------- Chromes eingebautes Sprachmodell (falls vorhanden) ---------------- */

// Automatische Tests: Ersatz-Modell aus vendor/test (nicht im Paket) statt Gemini Nano.
let fakeLoaded = null;
function loadFake(msg) {
  if (!msg.fake) return Promise.resolve();
  if (!fakeLoaded) {
    fakeLoaded = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'vendor/test/nano-fake.js';
      s.onload = s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }
  return fakeLoaded;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  if (msg.type === 'nanoStatus') {
    loadFake(msg).then(() => SFNano.availability()).then((a) => sendResponse({ ok: true, availability: a }));
    return true;
  }
  if (msg.type === 'nanoJudge') {
    loadFake(msg).then(() => SFNano.availability())
      .then((a) => {
        if (a !== 'available') throw new Error('nicht verfügbar');
        return SFNano.judge(msg.texts || [], msg.ctx || { topics: [] });
      })
      .then((harmless) => sendResponse({ ok: true, harmless }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  return false;
});
