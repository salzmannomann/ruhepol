/*
 * Service Worker: lädt Bilder (ohne CORS-Probleme dank host_permissions),
 * verwaltet die OCR-Warteschlange, den Ergebnis-Cache und die Zähler je Tab.
 * Die eigentliche Texterkennung läuft im Offscreen Document, weil Service Worker
 * keine Web Worker starten können.
 */
'use strict';

importScripts('lib/presets.js', 'lib/settings.js');

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
    case 'cacheSize':
      cacheSize().then((n) => sendResponse({ n }));
      return true;
    default:
      return false;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  // Fehlende Einstellungen mit Standardwerten auffüllen.
  // Nur fehlende Schlüssel schreiben, damit nichts Vorhandenes überschrieben wird.
  const raw = await chrome.storage.sync.get(SFSettings.KEYS);
  const missing = {};
  for (const k of SFSettings.KEYS) if (!(k in raw)) missing[k] = SFSettings.DEFAULTS[k];
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
});
