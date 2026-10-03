/*
 * Service Worker: lädt Bilder (ohne CORS-Probleme dank host_permissions),
 * verwaltet die OCR-Warteschlange, den Ergebnis-Cache und die Zähler je Tab.
 * Die eigentliche Texterkennung läuft im Offscreen Document, weil Service Worker
 * keine Web Worker starten können.
 */
'use strict';

importScripts('lib/match.js', 'lib/presets.js', 'lib/settings.js', 'lib/learn.js', 'lib/semantic.js');

const OCR_TIMEOUT_MS = 10000;
const MAX_PARALLEL = 2;
const CACHE_MAX = 2000;
const CACHE_PREFIX = 'ocr:';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_LEN = 4000;
const ERROR_RETRY_MS = 5 * 60 * 1000;
const OFFSCREEN_IDLE_MS = 3 * 60 * 1000;

/* ---------------- Cache (chrome.storage.local, ein Schlüssel je Bild-URL) ---------------- */

let cacheIndex = null; // Map url -> ts, lazy aufgebaut
let cacheIndexPromise = null;

function loadCacheIndex() {
  if (cacheIndex) return Promise.resolve(cacheIndex);
  if (!cacheIndexPromise) {
    cacheIndexPromise = chrome.storage.local.get(null).then((all) => {
      const m = new Map();
      for (const [k, v] of Object.entries(all)) {
        if (k.startsWith(CACHE_PREFIX) && v) m.set(k.slice(CACHE_PREFIX.length), v.ts || 0);
      }
      cacheIndex = m;
      return m;
    });
  }
  return cacheIndexPromise;
}

async function cacheGet(url) {
  const key = CACHE_PREFIX + url;
  const r = await chrome.storage.local.get(key);
  return r[key] || null;
}

async function cachePut(url, text) {
  const idx = await loadCacheIndex();
  const ts = Date.now();
  await chrome.storage.local.set({ [CACHE_PREFIX + url]: { t: text, ts } });
  idx.delete(url);
  idx.set(url, ts);
  if (idx.size > CACHE_MAX) {
    // Älteste zuerst löschen (etwas Puffer, damit nicht bei jedem Eintrag geräumt wird).
    const sorted = [...idx.entries()].sort((a, b) => a[1] - b[1]);
    const drop = sorted.slice(0, idx.size - CACHE_MAX + Math.ceil(CACHE_MAX * 0.05));
    for (const [u] of drop) idx.delete(u);
    await chrome.storage.local.remove(drop.map(([u]) => CACHE_PREFIX + u));
  }
}

async function cacheClear() {
  const idx = await loadCacheIndex();
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  idx.clear();
  recentErrors.clear();
  return keys.length;
}

async function cacheSize() {
  return (await loadCacheIndex()).size;
}

/* ---------------- Offscreen Document ---------------- */

let creatingOffscreen = null;
let offscreenIdleTimer = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Texterkennung (tesseract.js) in Web Workern',
      })
      .catch((e) => {
        // Parallel erzeugt? Dann ist alles gut.
        if (!String(e && e.message).includes('single offscreen')) throw e;
      })
      .finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

function scheduleOffscreenClose() {
  clearTimeout(offscreenIdleTimer);
  offscreenIdleTimer = setTimeout(async () => {
    if (active > 0 || queue.length) return;
    try { await chrome.offscreen.closeDocument(); } catch (_) { /* schon zu */ }
  }, OFFSCREEN_IDLE_MS);
}

/* ---------------- Warteschlange ---------------- */

const queue = [];
let active = 0;
const inflight = new Map(); // url -> Promise
const recentErrors = new Map(); // url -> ts (nicht persistent, kurzer Rückhalt)

function requestOcr(url, dataUrl) {
  if (!dataUrl && inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    if (!dataUrl) {
      const cached = await cacheGet(url);
      if (cached) return { ok: true, text: cached.t, cached: true };
      const errTs = recentErrors.get(url);
      if (errTs && Date.now() - errTs < ERROR_RETRY_MS) return { ok: false, error: 'kürzlich fehlgeschlagen' };
    }
    const res = await enqueue(() => runJob(url, dataUrl));
    if (res.ok) {
      recentErrors.delete(url);
      if (!dataUrl) await cachePut(url, res.text);
    } else if (!dataUrl) {
      recentErrors.set(url, Date.now());
    }
    return res;
  })().finally(() => inflight.delete(url));
  if (!dataUrl) inflight.set(url, p);
  return p;
}

function enqueue(fn) {
  return new Promise((resolve) => {
    queue.push({ fn, resolve });
    pump();
  });
}

function pump() {
  while (active < MAX_PARALLEL && queue.length) {
    const { fn, resolve } = queue.shift();
    active++;
    clearTimeout(offscreenIdleTimer);
    fn()
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
      .then((r) => {
        active--;
        resolve(r);
        pump();
        if (active === 0 && !queue.length) scheduleOffscreenClose();
      });
  }
}

async function runJob(url, dataUrl) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, error: 'Zeitüberschreitung' });
    }, OCR_TIMEOUT_MS);
  });
  const work = (async () => {
    const src = dataUrl || (await fetchAsDataUrl(url, controller.signal));
    await ensureOffscreen();
    const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'recognize', dataUrl: src });
    if (!r) return { ok: false, error: 'keine Antwort vom Offscreen Document' };
    if (!r.ok) return { ok: false, error: r.error || 'OCR fehlgeschlagen' };
    return { ok: true, text: String(r.text || '').slice(0, MAX_TEXT_LEN) };
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAsDataUrl(url, signal) {
  const res = await fetch(url, { signal, credentials: 'include', cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('Bild zu groß');
  if (blob.size === 0) throw new Error('leeres Bild');
  return blobToDataUrl(blob);
}

async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  const type = blob.type || 'application/octet-stream';
  return `data:${type};base64,${btoa(bin)}`;
}

/* ---------------- Zähler je Tab (chrome.storage.session) ---------------- */

let countChain = Promise.resolve();

function setCount(tabId, frameId, n) {
  // Nacheinander abarbeiten, damit sich Meldungen mehrerer Frames nicht überschreiben.
  countChain = countChain.then(() => writeCount(tabId, frameId, n)).catch(() => {});
  return countChain;
}

async function writeCount(tabId, frameId, n) {
  const key = 'count:' + tabId;
  const r = await chrome.storage.session.get(key);
  const frames = r[key] || {};
  frames[frameId] = n;
  await chrome.storage.session.set({ [key]: frames });
  const total = Object.values(frames).reduce((a, b) => a + b, 0);
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#555' });
    await chrome.action.setBadgeText({ tabId, text: total ? String(total) : '' });
  } catch (_) { /* Tab weg */ }
}

async function getCount(tabId) {
  const key = 'count:' + tabId;
  const r = await chrome.storage.session.get(key);
  return Object.values(r[key] || {}).reduce((a, b) => a + b, 0);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove('count:' + tabId);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) {
    chrome.storage.session.remove('count:' + tabId);
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
});

/* ---------------- Lernfilter: Bewertungen und Modell (chrome.storage.local) ---------------- */

const MAX_RATINGS = 3000;
const RATING_TEXT_MAX = 1500;
let learnChain = Promise.resolve();

function serialLearn(fn) {
  // Alle Änderungen nacheinander, damit sich gleichzeitige Bewertungen nicht überschreiben.
  const p = learnChain.then(fn);
  learnChain = p.catch(() => {});
  return p;
}

async function getRatings() {
  const r = await chrome.storage.local.get('ratings');
  return Array.isArray(r.ratings) ? r.ratings : [];
}

async function saveRatings(ratings, model, fromSync) {
  await chrome.storage.local.set({ ratings, model: model || SFLearn.build(ratings) });
  semRef = null; // Bedeutungs-Filter: Bezugspunkte beim nächsten Mal neu zusammenstellen
  if (!fromSync) schedulePush();
}

function addRating(text, label, host) {
  return serialLearn(async () => {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, RATING_TEXT_MAX);
    if (!text || (label !== 'b' && label !== 'o')) return { ok: false };
    let ratings = await getRatings();
    // Gleicher Text erneut bewertet: alte Bewertung ersetzen.
    ratings = ratings.filter((r) => r.text !== text);
    ratings.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), label, host: host || '', text });
    if (ratings.length > MAX_RATINGS) ratings = ratings.slice(-MAX_RATINGS);
    await saveRatings(ratings);
    return { ok: true, n: ratings.length };
  });
}

function deleteRating(id) {
  return serialLearn(async () => {
    const ratings = (await getRatings()).filter((r) => r.id !== id);
    const { syncDeleted = [] } = await chrome.storage.local.get('syncDeleted');
    await chrome.storage.local.set({ syncDeleted: syncDeleted.concat(id).slice(-MAX_TOMBSTONES) });
    await saveRatings(ratings);
    return { ok: true };
  });
}

function resetLearning() {
  return serialLearn(async () => {
    await chrome.storage.local.set({ ratings: [], model: SFLearn.emptyModel(), syncResetTs: Date.now(), syncDeleted: [] });
    schedulePush();
    return { ok: true };
  });
}

/* ---------------- Bewertungen über chrome.storage.sync abgleichen ----------------
 * Damit das Gelernte auf allen Rechnern mit demselben Chrome-Konto gleich ist, werden die
 * neuesten Bewertungen (gekürzt) in chrome.storage.sync gespiegelt. Dessen Platz ist klein
 * (100 KB, 8 KB je Eintrag), daher: Text auf SYNC_TEXT_MAX Zeichen gekürzt, aufgeteilt auf
 * Einträge "ratings0", "ratings1", ...; zusammen höchstens SYNC_BUDGET Bytes.
 * Gelöschte Bewertungen werden als Liste von IDs mitgeschickt, "Zurücksetzen" als Zeitstempel.
 */

const SYNC_TEXT_MAX = 280;
const SYNC_BUDGET = 70 * 1024;
const SYNC_CHUNK = 7000;
const SYNC_PREFIX = 'ratings';
const MAX_TOMBSTONES = 300;
let pushTimer = null;

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => serialLearn(pushSync).catch(() => {}), 4000);
}

async function readSync() {
  const all = await chrome.storage.sync.get(null);
  const chunks = Object.keys(all)
    .filter((k) => k.startsWith(SYNC_PREFIX) && /^\d+$/.test(k.slice(SYNC_PREFIX.length)))
    .sort((a, b) => Number(a.slice(SYNC_PREFIX.length)) - Number(b.slice(SYNC_PREFIX.length)));
  const list = [];
  for (const k of chunks) for (const r of all[k] || []) list.push({ id: r[0], ts: r[1], label: r[2], host: r[3], text: r[4] });
  return { list, keys: chunks, deleted: all.ratingsDeleted || [], resetTs: all.ratingsReset || 0 };
}

async function pushSync() {
  const ratings = await getRatings();
  const local = await chrome.storage.local.get(['syncDeleted', 'syncResetTs']);
  const remote = await readSync();
  // Neueste zuerst einpacken, bis das Budget erreicht ist.
  const packed = [];
  let size = 0;
  for (let i = ratings.length - 1; i >= 0; i--) {
    const r = ratings[i];
    const row = [r.id, r.ts, r.label, r.host, r.text.slice(0, SYNC_TEXT_MAX)];
    const len = JSON.stringify(row).length + 1;
    if (size + len > SYNC_BUDGET) break;
    size += len;
    packed.unshift(row);
  }
  const chunks = [];
  let cur = [], curLen = 2;
  for (const row of packed) {
    const len = JSON.stringify(row).length + 1;
    if (curLen + len > SYNC_CHUNK && cur.length) { chunks.push(cur); cur = []; curLen = 2; }
    cur.push(row); curLen += len;
  }
  if (cur.length) chunks.push(cur);
  const data = {
    ratingsDeleted: [...new Set((remote.deleted || []).concat(local.syncDeleted || []))].slice(-MAX_TOMBSTONES),
    ratingsReset: Math.max(remote.resetTs || 0, local.syncResetTs || 0),
  };
  chunks.forEach((c, i) => { data[SYNC_PREFIX + i] = c; });
  const stale = remote.keys.filter((k) => !(k in data));
  try {
    await chrome.storage.sync.set(data);
    if (stale.length) await chrome.storage.sync.remove(stale);
  } catch (e) {
    console.warn('Ruhepol: Sync fehlgeschlagen', e);
  }
}

/** Bewertungen anderer Geräte übernehmen. */
function pullSync() {
  return serialLearn(async () => {
    const remote = await readSync();
    const local = await chrome.storage.local.get(['syncDeleted', 'syncResetTs']);
    const resetTs = Math.max(remote.resetTs || 0, local.syncResetTs || 0);
    const deleted = new Set((remote.deleted || []).concat(local.syncDeleted || []));
    const current = await getRatings();
    const byId = new Map();
    for (const r of current) byId.set(r.id, r);
    let changed = false;
    for (const r of remote.list) {
      if (!r || !r.id || byId.has(r.id) || (r.label !== 'b' && r.label !== 'o')) continue;
      byId.set(r.id, { id: r.id, ts: r.ts, label: r.label, host: r.host || '', text: String(r.text || '') });
      changed = true;
    }
    let merged = [...byId.values()].filter((r) => r.ts >= resetTs && !deleted.has(r.id));
    if (merged.length !== byId.size) changed = true;
    if (!changed) return;
    merged.sort((a, b) => a.ts - b.ts);
    if (merged.length > MAX_RATINGS) merged = merged.slice(-MAX_RATINGS);
    await chrome.storage.local.set({ syncResetTs: resetTs, syncDeleted: [...deleted].slice(-MAX_TOMBSTONES) });
    await saveRatings(merged, null, true);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (Object.keys(changes).some((k) => k.startsWith(SYNC_PREFIX))) pullSync().catch(() => {});
});

function importRatings(list) {
  return serialLearn(async () => {
    const clean = (Array.isArray(list) ? list : [])
      .filter((r) => r && typeof r.text === 'string' && (r.label === 'b' || r.label === 'o'))
      .map((r, i) => ({
        id: String(r.id || Date.now().toString(36) + i),
        ts: Number(r.ts) || Date.now(),
        label: r.label,
        host: String(r.host || ''),
        text: r.text.slice(0, RATING_TEXT_MAX),
      }));
    const byText = new Map();
    for (const r of (await getRatings()).concat(clean)) byText.set(r.text, r);
    const ratings = [...byText.values()].sort((a, b) => a.ts - b.ts).slice(-MAX_RATINGS);
    await saveRatings(ratings);
    return { ok: true, n: ratings.length };
  });
}

async function learnInfo() {
  const ratings = await getRatings();
  const r = await chrome.storage.local.get('model');
  const model = r.model || SFLearn.build(ratings);
  return {
    total: ratings.length,
    b: model.docs.b,
    o: model.docs.o,
    ready: SFLearn.ready(model),
    minEach: SFLearn.MIN_EACH,
    minTotal: SFLearn.MIN_TOTAL,
    top: SFLearn.topFeatures(model, 15),
    recent: ratings.slice(-40).reverse(),
  };
}

/* ---------------- Bedeutungs-Filter (Stufe 2) ----------------
 * Texte werden im Offscreen Document von einem lokalen Sprachmodell in Vektoren umgerechnet.
 * Bezugspunkte: Vektoren der Bewertungen (gespeichert in chrome.storage.local "semIndex"),
 * der Themen-Beschreibungen aktivierter Vorschlagslisten und eigener Schlagwörter sowie
 * neutrale Vergleichstexte. Entscheidung: lib/semantic.js.
 */

const SEM_BATCH = 16;
const SEM_CACHE_MAX = 3000;
const semCache = new Map(); // "model|text" -> Float32Array
let semRef = null;
let semChain = Promise.resolve();

function serialSem(fn) {
  const p = semChain.then(fn);
  semChain = p.catch(() => {});
  return p;
}

async function semModelId() {
  // Für Tests kann ein anderes Modell gesetzt werden (chrome.storage.local "semModel").
  const r = await chrome.storage.local.get('semModel');
  return r.semModel || SFSemantic.DEFAULT_MODEL;
}

async function semInstalled(model) {
  // Konfiguration und die (große) Modelldatei müssen da sein; von der Modelldatei nur den
  // Anfang anfragen und den Rest gleich verwerfen.
  try {
    const cfg = await fetch(chrome.runtime.getURL(`vendor/models/${model}/config.json`));
    if (!cfg.ok) return false;
    const onnx = await fetch(chrome.runtime.getURL(`vendor/models/${model}/onnx/model_quantized.onnx`));
    if (onnx.body) onnx.body.cancel().catch(() => {});
    return onnx.ok;
  } catch (_) {
    return false;
  }
}

/** Texte in Vektoren umrechnen (mit Zwischenspeicher, in Paketen). */
async function embedTexts(model, texts) {
  const cfg = SFSemantic.modelConfig(model);
  const out = new Array(texts.length);
  const todo = [];
  texts.forEach((t, i) => {
    const hit = semCache.get(model + '|' + t);
    if (hit) out[i] = hit; else todo.push(i);
  });
  for (let k = 0; k < todo.length; k += SEM_BATCH) {
    const idx = todo.slice(k, k + SEM_BATCH);
    await ensureOffscreen();
    const r = await chrome.runtime.sendMessage({
      target: 'offscreen', type: 'embed', model, prefix: cfg.prefix, texts: idx.map((i) => texts[i]),
    });
    if (!r || !r.ok) throw new Error((r && r.error) || 'Sprachmodell nicht verfügbar');
    idx.forEach((i, j) => {
      const v = Float32Array.from(r.vectors[j]);
      out[i] = v;
      semCache.set(model + '|' + texts[i], v);
    });
  }
  while (semCache.size > SEM_CACHE_MAX) semCache.delete(semCache.keys().next().value);
  return out;
}

function anchorTexts(settings) {
  const own = settings.keywords
    .map((k) => k.replace(/\*/g, '').trim())
    .filter((k) => k.length >= 4);
  return SFPresets.aboutFor(settings.presets).concat(own);
}

/** Bezugspunkte zusammenstellen; Bewertungs-Vektoren werden dauerhaft gespeichert. */
async function semReference(settings, model) {
  const anchors = anchorTexts(settings);
  const key = JSON.stringify([model, anchors]);
  if (semRef && semRef.key === key) return semRef;
  const ratings = await getRatings();
  const stored = (await chrome.storage.local.get('semIndex')).semIndex;
  const vecs = stored && stored.model === model ? stored.vecs : {};
  const missing = ratings.filter((r) => !vecs[r.id]);
  if (missing.length) {
    const v = await embedTexts(model, missing.map((r) => r.text.slice(0, 600)));
    missing.forEach((r, i) => { vecs[r.id] = SFSemantic.pack(v[i]); });
  }
  const ids = new Set(ratings.map((r) => r.id));
  for (const id of Object.keys(vecs)) if (!ids.has(id)) delete vecs[id];
  await chrome.storage.local.set({ semIndex: { model, vecs } });
  const b = [], o = [];
  for (const r of ratings) (r.label === 'b' ? b : o).push(SFSemantic.unpack(vecs[r.id]));
  semRef = {
    key,
    b,
    o,
    anchors: anchors.length ? await embedTexts(model, anchors) : [],
    neutral: await embedTexts(model, SFSemantic.NEUTRAL),
  };
  return semRef;
}

function semScore(texts) {
  return serialSem(async () => {
    const settings = await SFSettings.load();
    if (!settings.semantic) return { ok: false, error: 'aus' };
    const model = await semModelId();
    if (!(await semInstalled(model))) return { ok: false, error: 'Modell nicht installiert' };
    const ref = await semReference(settings, model);
    const vecs = await embedTexts(model, texts.map((t) => String(t).slice(0, 600)));
    return { ok: true, results: vecs.map((v) => SFSemantic.decide(v, ref, model, settings.semanticLevel)) };
  }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
}

/** Gute Nachrichten trotz gesperrtem Thema: Ton der Texte bestimmen. */
function toneScore(texts) {
  return serialSem(async () => {
    const settings = await SFSettings.load();
    if (!settings.positiveShow) return { ok: false, error: 'aus' };
    const model = await semModelId();
    if (!(await semInstalled(model))) return { ok: false, error: 'Modell nicht installiert' };
    const keys = Object.keys(SFSemantic.TONE);
    const posTexts = keys.map((k) => SFSemantic.TONE[k][0]).filter(Boolean);
    const negTexts = keys.map((k) => SFSemantic.TONE[k][1]);
    const posVecs = await embedTexts(model, posTexts);
    const negVecs = await embedTexts(model, negTexts);
    let pi = 0;
    const pairs = keys.map((k, i) => ({
      topic: k,
      pos: SFSemantic.TONE[k][0] ? posVecs[pi++] : null,
      neg: negVecs[i],
    }));
    const vecs = await embedTexts(model, texts.map((t) => String(t).slice(0, 600)));
    return { ok: true, results: vecs.map((v) => SFSemantic.tone(v, pairs, model, settings.positiveLevel)) };
  }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
}

async function semStatus() {
  const model = await semModelId();
  const stored = (await chrome.storage.local.get('semIndex')).semIndex;
  return {
    model,
    installed: await semInstalled(model),
    indexed: stored && stored.model === model ? Object.keys(stored.vecs).length : 0,
  };
}

/* ---------------- Rechtsklickmenü ---------------- */

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    const all = ['page', 'link', 'image', 'video', 'selection'];
    const sel = ['selection'];
    const add = (o) => chrome.contextMenus.create(o, () => void chrome.runtime.lastError);
    add({ id: 'sf-block', title: '👎  Künftig ausblenden', contexts: all });
    add({ id: 'sf-ok', title: '👍  Künftig anzeigen', contexts: all });
    add({ id: 'sf-sep1', type: 'separator', contexts: sel });
    add({ id: 'sf-add', title: '„%s“ als Schlagwort ausblenden', contexts: sel });
    add({ id: 'sf-allow', title: '„%s“ nie ausblenden', contexts: sel });
    add({ id: 'sf-sep2', type: 'separator', contexts: all });
    add({ id: 'sf-zone', title: 'Ganzen Bereich auf dieser Seite sperren …', contexts: all });
    add({ id: 'sf-site', title: 'Auf dieser Seite ein/aus', contexts: all });
    add({ id: 'sf-options', title: 'Einstellungen …', contexts: all });
  });
}

function cleanTerm(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().replace(/^[„“"'»«]+|[„“"'»«.,;:!?]+$/g, '').slice(0, 80);
}

/** Markierten Text in eine Liste (keywords oder allow) aufnehmen. Liefert {added, term}. */
async function addToList(key, text) {
  const term = cleanTerm(text);
  if (!term) return { added: false, term };
  const s = await SFSettings.load();
  if (s[key].some((k) => k.toLowerCase() === term.toLowerCase())) return { added: false, term };
  await SFSettings.save({ [key]: s[key].concat(term) });
  return { added: true, term };
}

function addKeyword(text) { return addToList('keywords', text); }
function addAllow(text) { return addToList('allow', text); }

/** Ruhepol für die Domain eines Tabs umschalten. Liefert {host, active} oder null. */
async function toggleSite(url) {
  const host = safeHost(url);
  if (!host) return null;
  const s = await SFSettings.load();
  const active = !SFSettings.isActiveOn(Object.assign({}, s, { enabled: true }), host);
  await SFSettings.save({ siteList: SFSettings.toggleHost(s, host, active) });
  return { host: SFSettings.normalizeHost(host), active };
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'sf-options') { chrome.runtime.openOptionsPage(); return; }
  if (!tab || tab.id < 0) return;
  const frame = { frameId: info.frameId || 0 };
  const toast = (text) => chrome.tabs.sendMessage(tab.id, { type: 'toast', text }, frame).catch(() => {});
  if (info.menuItemId === 'sf-add') {
    const r = await addKeyword(info.selectionText);
    toast(r.added ? `„${r.term}“ wird künftig ausgeblendet` : `„${r.term}“ ist schon ein Schlagwort`);
    return;
  }
  if (info.menuItemId === 'sf-allow') {
    const r = await addAllow(info.selectionText);
    toast(r.added ? `„${r.term}“ wird nie ausgeblendet` : `„${r.term}“ steht schon auf „Nie ausblenden“`);
    return;
  }
  if (info.menuItemId === 'sf-site') {
    const r = await toggleSite(tab.url);
    if (r) toast(r.active ? `Ruhepol ist auf ${r.host} wieder an` : `Ruhepol ist auf ${r.host} aus`);
    return;
  }
  const action = { 'sf-block': 'block', 'sf-ok': 'ok', 'sf-zone': 'zone' }[info.menuItemId] || null;
  if (!action) return;
  chrome.tabs.sendMessage(tab.id, { type: 'ctx', action }, frame).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  createMenus();
  pullSync().then(schedulePush).catch(() => {});
});

/* ---------------- Nachrichten ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;
  switch (msg.type) {
    case 'ocr':
      if (typeof msg.url !== 'string') return false;
      requestOcr(msg.url, typeof msg.dataUrl === 'string' ? msg.dataUrl : null).then(sendResponse);
      return true;
    case 'count':
      if (sender.tab) setCount(sender.tab.id, sender.frameId || 0, Number(msg.n) || 0);
      return false;
    case 'getCount':
      getCount(msg.tabId).then((n) => sendResponse({ n }));
      return true;
    case 'cacheClear':
      cacheClear().then((n) => sendResponse({ removed: n }));
      return true;
    case 'train':
      addRating(msg.text, msg.label, sender.tab ? safeHost(sender.tab.url) : '').then(sendResponse);
      return true;
    case 'learnInfo':
      learnInfo().then(sendResponse);
      return true;
    case 'deleteRating':
      deleteRating(msg.id).then(sendResponse);
      return true;
    case 'resetLearning':
      resetLearning().then(sendResponse);
      return true;
    case 'exportRatings':
      getRatings().then((ratings) => sendResponse({ ratings }));
      return true;
    case 'importRatings':
      importRatings(msg.ratings).then(sendResponse);
      return true;
    case 'semScore':
      semScore(Array.isArray(msg.texts) ? msg.texts.slice(0, 32) : []).then(sendResponse);
      return true;
    case 'toneScore':
      toneScore(Array.isArray(msg.texts) ? msg.texts.slice(0, 32) : []).then(sendResponse);
      return true;
    case 'semStatus':
      semStatus().then(sendResponse);
      return true;
    case 'cacheSize':
      cacheSize().then((n) => sendResponse({ n }));
      return true;
    default:
      return false;
  }
});

function olderThan(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

function safeHost(url) {
  try { return new URL(url).hostname; } catch (_) { return ''; }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  createMenus();
  // Ab 1.3.1 ist „Aufdecken durch Gedrückthalten“ Standard: einmalig auch bei Updates einschalten.
  if (details && details.reason === 'update' && olderThan(details.previousVersion, '1.3.1')) {
    await chrome.storage.sync.set({ revealHold: true });
  }
  pullSync().then(schedulePush).catch(() => {});
  // Fehlende Einstellungen mit Standardwerten auffüllen.
  // Nur fehlende Schlüssel schreiben, damit nichts Vorhandenes überschrieben wird.
  const raw = await chrome.storage.sync.get(SFSettings.KEYS);
  const missing = {};
  for (const k of SFSettings.KEYS) if (!(k in raw)) missing[k] = SFSettings.DEFAULTS[k];
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
});
