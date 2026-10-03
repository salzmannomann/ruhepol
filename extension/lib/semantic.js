/*
 * Bedeutungs-Filter (Stufe 2), reine Logik ohne Browser-APIs.
 *
 * Ein lokales Sprachmodell (im Offscreen Document) macht aus jedem Text einen Vektor
 * ("Embedding"); Texte mit ähnlicher Bedeutung liegen nah beieinander (Kosinus-Ähnlichkeit).
 * Ein Teaser wird ausgeblendet, wenn er deutlich näher an
 *   - deinen "ausblenden"-Bewertungen oder
 *   - den Beschreibungen der aktivierten Themen (Vorschlagslisten, eigene Schlagwörter)
 * liegt als an
 *   - deinen "will ich sehen"-Bewertungen und
 *   - neutralen Vergleichstexten (Kultur, Sport, Wetter …).
 */
(function (root) {
  'use strict';

  const DEFAULT_MODEL = 'Xenova/multilingual-e5-small';

  /**
   * Je Modell: Text-Präfix (e5 erwartet "query: ") und Schwellen für die Stufen
   * vorsichtig / mittel / stark. floor = Mindestähnlichkeit zum Unerwünschten,
   * margin = Mindestabstand zum Erwünschten/Neutralen.
   *
   * e5-Werte kalibriert mit test/kalibrierung.mjs (32 deutsche/englische Schlagzeilen, alle
   * Vorschlagslisten aktiv): Unbedenkliche liegen beim Abstand Thema − neutral bei ≤ −0,004,
   * belastende meist bei +0,015 … +0,054. Ergebnis: vorsichtig 6/16, mittel 12/16,
   * stark 13/16 belastende erkannt, jeweils 0/16 Fehltreffer.
   */
  const MODELS = {
    'Xenova/multilingual-e5-small': {
      prefix: 'query: ',
      floor: { vorsichtig: 0.82, mittel: 0.8, stark: 0.78 },
      margin: { vorsichtig: 0.03, mittel: 0.015, stark: 0.005 },
    },
    // Winziges Testmodell (test/make_tiny_model.py), nur für automatische Tests.
    'test/tiny': {
      prefix: '',
      floor: { vorsichtig: 0.7, mittel: 0.6, stark: 0.5 },
      margin: { vorsichtig: 0.3, mittel: 0.2, stark: 0.1 },
    },
  };

  const LEVELS = ['vorsichtig', 'mittel', 'stark'];

  // Neutrale Vergleichstexte: was hier am nächsten liegt, gilt als unbedenklich.
  const NEUTRAL = [
    'Kultur: Konzert, Theater, Museum, Ausstellung und Musik.',
    'Sport: Fußball, Skifahren, Tennis, Ergebnisse und Tabellen.',
    'Wetter: sonnig, mild, Regen am Wochenende, Temperaturen.',
    'Freizeit und Reisen: Ausflug, Urlaub, Wandern, Restaurant, Rezept.',
    'Wissenschaft und Technik: Forschung, Entdeckung, neues Smartphone.',
    'Lokales: neue Radwege, Bahnstrecke eröffnet, Stadtfest, Schule.',
    'Wohnen und Alltag: Wohnungen, Mieten, Familie, Einkaufen.',
  ];

  function modelConfig(id) {
    return MODELS[id] || MODELS[DEFAULT_MODEL];
  }

  function cosine(a, b) {
    // Vektoren sind normalisiert: Skalarprodukt = Kosinus.
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  /** Mittelwert der k höchsten Ähnlichkeiten (robuster als nur der nächste Nachbar). */
  function topK(vec, list, k) {
    if (!list.length) return 0;
    const sims = list.map((v) => cosine(vec, v)).sort((x, y) => y - x);
    const n = Math.min(k, sims.length);
    let s = 0;
    for (let i = 0; i < n; i++) s += sims[i];
    return s / n;
  }

  function maxSim(vec, list) {
    let m = 0;
    for (const v of list) m = Math.max(m, cosine(vec, v));
    return m;
  }

  /**
   * Entscheidung für einen Text-Vektor.
   * ref = {b: [...], o: [...], anchors: [...], neutral: [...]} (Listen von Vektoren)
   */
  function decide(vec, ref, modelId, level) {
    const cfg = modelConfig(modelId);
    const lv = LEVELS.includes(level) ? level : 'mittel';
    const bad = Math.max(topK(vec, ref.b, 3), maxSim(vec, ref.anchors));
    const good = Math.max(topK(vec, ref.o, 3), maxSim(vec, ref.neutral));
    const hide = bad >= cfg.floor[lv] && bad - good >= cfg.margin[lv];
    return { hide, bad: round(bad), good: round(good) };
  }

  function round(x) {
    return Math.round(x * 1000) / 1000;
  }

  /** Vektor kompakt speichern: int8 (Werte -1..1) als Base64. */
  function pack(vec) {
    const bytes = new Uint8Array(vec.length);
    for (let i = 0; i < vec.length; i++) {
      bytes[i] = (Math.max(-127, Math.min(127, Math.round(vec[i] * 127))) + 256) % 256;
    }
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoaSafe(bin);
  }

  function unpack(str) {
    const bin = atobSafe(str);
    const vec = new Float32Array(bin.length);
    let norm = 0;
    for (let i = 0; i < bin.length; i++) {
      const b = bin.charCodeAt(i);
      vec[i] = (b > 127 ? b - 256 : b) / 127;
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
  }

  function btoaSafe(bin) {
    return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  }

  function atobSafe(str) {
    return typeof atob === 'function' ? atob(str) : Buffer.from(str, 'base64').toString('binary');
  }

  const api = { DEFAULT_MODEL, MODELS, LEVELS, NEUTRAL, modelConfig, cosine, topK, maxSim, decide, pack, unpack };
  root.SFSemantic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
