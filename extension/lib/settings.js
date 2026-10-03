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
    learnThreshold: 0.95,
    // Bedeutungs-Filter (Stufe 2, lokales Sprachmodell): aus, bis das Modell installiert ist
    semantic: false,
    // 'vorsichtig' | 'mittel' | 'stark'
    semanticLevel: 'mittel',
    // Schlagwort-Treffer mit dem Sprachmodell gegenprüfen (Doppeldeutigkeiten wie „Schüsse“ im Sport)
    semanticVeto: true,
    // Gute Nachrichten zu gesperrten Themen trotzdem zeigen (braucht das Sprachmodell)
    positiveShow: false,
    positiveLevel: 'mittel',
    // Aufdecken nur durch Gedrückthalten (2 s), schützt vor reflexhaftem Klicken
    revealHold: true,
    // Artikel, die man über einen nicht gesperrten (oder selbst aufgedeckten) Teaser öffnet,
    // vollständig zeigen – Teaser-Leisten daneben bleiben gefiltert
    trustOpened: true,
    // Wünsche in eigenen Worten (ganze Sätze) für das Sprachmodell
    wishNo: [], // „Will ich nicht sehen“
    wishYes: [], // „Will ich trotzdem sehen“
    // Grenzfälle zusätzlich von Chromes eingebautem Modell (Gemini Nano) prüfen lassen, falls vorhanden
    nanoCheck: true,
    // Gesperrte Bereiche: [{host, sel (CSS-Selektor), head (erste Überschrift, optional)}]
    zones: [],
    // Verhalten bei OCR-Fehler/Timeout: 'show' (scharf stellen) | 'blur' (unscharf lassen) | 'hide'
    onError: 'show',
  });

  const KEYS = Object.keys(DEFAULTS);

  // Grenzen halten storage.sync (8 KB je Eintrag) auch bei großen Importen ein.
  const MAX_TERM_LEN = 80;
  const MAX_TERMS = 400;

  function cleanList(list, maxLen = MAX_TERM_LEN) {
    const out = [];
    for (const k of list) {
      if (typeof k !== 'string' && typeof k !== 'number') continue;
      const t = String(k).trim().slice(0, maxLen);
      if (t && !out.includes(t)) out.push(t);
      if (out.length >= MAX_TERMS) break;
    }
    return out;
  }

  const MAX_WISH_LEN = 200;
  const MAX_WISHES = 30;

  function cleanWishes(list) {
    return cleanList(list, MAX_WISH_LEN).slice(0, MAX_WISHES);
  }

  function sanitize(raw) {
    const s = Object.assign({}, DEFAULTS);
    if (!raw || typeof raw !== 'object') return s;
    if (typeof raw.enabled === 'boolean') s.enabled = raw.enabled;
    if (Array.isArray(raw.keywords)) {
      s.keywords = cleanList(raw.keywords);
    }
    if (Array.isArray(raw.allow)) {
      s.allow = cleanList(raw.allow);
    }
    if (Array.isArray(raw.wishNo)) s.wishNo = cleanWishes(raw.wishNo);
    if (Array.isArray(raw.wishYes)) s.wishYes = cleanWishes(raw.wishYes);
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
    if (['vorsichtig', 'mittel', 'stark'].includes(raw.semanticLevel)) s.semanticLevel = raw.semanticLevel;
    if (['vorsichtig', 'mittel', 'stark'].includes(raw.positiveLevel)) s.positiveLevel = raw.positiveLevel;
    for (const k of ['learn', 'learnHide', 'revealHold', 'semantic', 'semanticVeto', 'positiveShow', 'nanoCheck', 'trustOpened']) {
      if (typeof raw[k] === 'boolean') s[k] = raw[k];
    }
    const thr = Number(raw.learnThreshold);
    if (Number.isFinite(thr) && thr >= 0.5 && thr <= 0.99) s.learnThreshold = thr;
    if (Array.isArray(raw.presets) && P) {
      s.presets = P.ALL_IDS.filter((id) => raw.presets.includes(id));
    }
    if (raw.siteMode === 'all' || raw.siteMode === 'only') s.siteMode = raw.siteMode;
    if (Array.isArray(raw.siteList)) {
      s.siteList = raw.siteList.filter((h) => typeof h === 'string').map(normalizeHost).filter(Boolean).slice(0, MAX_TERMS);
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

  /**
   * Speichert nur die übergebenen Schlüssel. So überschreibt z. B. die Einstellungsseite kein
   * Schlagwort, das inzwischen über das Kontextmenü dazukam. Ungültige Werte behalten den
   * gespeicherten Wert statt auf den Standard zurückzufallen.
   */
  async function save(partial) {
    const loaded = await load();
    const changes = {};
    for (const k of Object.keys(partial || {})) {
      if (!KEYS.includes(k)) continue;
      const v = sanitize(Object.assign({}, loaded, { [k]: partial[k] }))[k];
      // Einfacher Wert, der beim Bereinigen auf den Standard zurückfiel: war ungültig.
      const d = DEFAULTS[k];
      const fellBack = !Array.isArray(d) && v === d && String(partial[k]) !== String(d);
      changes[k] = fellBack ? loaded[k] : v;
    }
    if (Object.keys(changes).length) await chrome.storage.sync.set(changes);
    return Object.assign(loaded, changes);
  }

  root.SFSettings = { DEFAULTS, KEYS, sanitize, normalizeHost, hostInList, isActiveOn, toggleHost, allKeywords, load, save };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SFSettings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
