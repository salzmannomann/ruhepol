/*
 * Gemeinsame Einstellungen (chrome.storage.sync) und Seitenregeln.
 * Klassisches Skript: stellt globalThis.SFSettings bereit.
 */
(function (root) {
  'use strict';

  const P = root.SFPresets || (typeof require === 'function' ? require('./presets.js') : null);

  const DEFAULTS = Object.freeze({
    enabled: true,
    keywords: [],
    // "Nie ausblenden": diese Wörter lösen nie einen Treffer aus (z. B. Wohnungskrise)
    allow: [],
    // aktivierte Vorschlagslisten (IDs aus lib/presets.js); Standard: alle
    presets: P ? P.ALL_IDS.slice() : [],
    // 'all'  = auf allen Seiten außer denen in siteList
    // 'only' = nur auf den Seiten in siteList
    siteMode: 'all',
    siteList: [],
    minWidth: 120,
    minHeight: 80,
    // 'hide' | 'blur' | 'placeholder'
    display: 'blur',
    ocr: true,
    partial: false,
    fuzzy: false,
    // Lernfilter: aus Bewertungen lernen
    learn: true,
    // gelernte Inhalte auch ohne Schlagwort ausblenden, ab dieser Sicherheit
    learnHide: true,
    learnThreshold: 0.9,
    // Aufdecken nur durch Gedrückthalten (1 s), schützt vor reflexhaftem Klicken
    revealHold: false,
    // Gesperrte Bereiche: [{host, sel (CSS-Selektor), head (erste Überschrift, optional)}]
    zones: [],
    // Verhalten bei OCR-Fehler/Timeout: 'show' (scharf stellen) | 'blur' (unscharf lassen) | 'hide'
    onError: 'show',
  });

  const KEYS = Object.keys(DEFAULTS);

  function sanitize(raw) {
    const s = Object.assign({}, DEFAULTS);
    if (!raw || typeof raw !== 'object') return s;
    if (typeof raw.enabled === 'boolean') s.enabled = raw.enabled;
    if (Array.isArray(raw.keywords)) {
      s.keywords = raw.keywords.map((k) => String(k).trim()).filter(Boolean);
    }
    if (Array.isArray(raw.allow)) {
      s.allow = raw.allow.map((k) => String(k).trim()).filter(Boolean);
    }
    if (Array.isArray(raw.zones)) {
      s.zones = raw.zones
        .filter((z) => z && typeof z.sel === 'string' && z.sel.trim() && z.sel.length <= 300)
        .map((z) => ({
          host: normalizeHost(z.host),
          sel: z.sel.trim(),
          head: String(z.head || '').slice(0, 80),
          label: String(z.label || z.head || '').slice(0, 80),
        }))
        .filter((z) => z.host)
        .slice(0, 200);
    }
    for (const k of ['learn', 'learnHide', 'revealHold']) {
      if (typeof raw[k] === 'boolean') s[k] = raw[k];
    }
    const thr = Number(raw.learnThreshold);
    if (Number.isFinite(thr) && thr >= 0.5 && thr <= 0.99) s.learnThreshold = thr;
    if (Array.isArray(raw.presets) && P) {
      s.presets = P.ALL_IDS.filter((id) => raw.presets.includes(id));
    }
    if (raw.siteMode === 'all' || raw.siteMode === 'only') s.siteMode = raw.siteMode;
    if (Array.isArray(raw.siteList)) {
      s.siteList = raw.siteList.map(normalizeHost).filter(Boolean);
    }
    for (const k of ['minWidth', 'minHeight']) {
      const n = Number(raw[k]);
      if (Number.isFinite(n) && n >= 0) s[k] = Math.round(n);
    }
    if (['hide', 'blur', 'placeholder'].includes(raw.display)) s.display = raw.display;
    for (const k of ['ocr', 'partial', 'fuzzy']) {
      if (typeof raw[k] === 'boolean') s[k] = raw[k];
    }
    if (['show', 'blur', 'hide'].includes(raw.onError)) s.onError = raw.onError;
    return s;
  }

  /** "https://www.Orf.at/foo" -> "orf.at", "*.orf.at" -> "orf.at" */
  function normalizeHost(input) {
    let h = String(input || '').trim().toLowerCase();
    if (!h) return '';
    h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    h = h.split(/[/?#]/)[0];
    h = h.replace(/:\d+$/, '');
    h = h.replace(/^\*\./, '').replace(/^www\./, '').replace(/\.$/, '');
    return h;
  }

  /** Passt der Host (inkl. Subdomains) zu einem Eintrag der Liste? */
  function hostInList(host, list) {
    const h = normalizeHost(host);
    if (!h) return false;
    return list.some((entry) => h === entry || h.endsWith('.' + entry));
  }

  function isActiveOn(settings, host) {
    if (!settings.enabled) return false;
    const listed = hostInList(host, settings.siteList);
    return settings.siteMode === 'all' ? !listed : listed;
  }

  /** Schaltet den Filter für einen Host um, abhängig vom Modus. Liefert neue siteList. */
  function toggleHost(settings, host, active) {
    const h = normalizeHost(host);
    let list = settings.siteList.slice();
    // Im Modus "alle außer" bedeutet Eintrag = aus; im Modus "nur auf" bedeutet Eintrag = an.
    const wantListed = settings.siteMode === 'all' ? !active : active;
    if (wantListed) {
      if (!hostInList(h, list)) list.push(h);
    } else {
      list = list.filter((entry) => !(h === entry || h.endsWith('.' + entry)));
    }
    return list;
  }

  /** Eigene Schlagwörter plus Begriffe der aktivierten Vorschlagslisten. */
  function allKeywords(settings) {
    return settings.keywords.concat(P ? P.termsFor(settings.presets) : []);
  }

  async function load() {
    const raw = await chrome.storage.sync.get(KEYS);
    return sanitize(raw);
  }

  async function save(partial) {
    const merged = sanitize(Object.assign(await load(), partial));
    await chrome.storage.sync.set(merged);
    return merged;
  }

  root.SFSettings = { DEFAULTS, KEYS, sanitize, normalizeHost, hostInList, isActiveOn, toggleHost, allKeywords, load, save };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SFSettings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
