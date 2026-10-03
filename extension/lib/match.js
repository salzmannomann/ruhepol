/*
 * Schlagwort-Abgleich.
 * - Groß-/Kleinschreibung egal, Umlaute normalisiert (ä=ae, ö=oe, ü=ue, ß=ss),
 *   sonstige Akzente entfernt (é=e).
 * - Standard: ganze Wörter (bzw. ganze Wortfolgen bei Begriffen mit Leerzeichen).
 * - Optional Teilwort-Treffer ("ball" findet "Fußballspiel").
 * - Optional unscharfer Abgleich für OCR-Fehler: Levenshtein-Distanz 1 bei Wörtern
 *   ab 6 Zeichen.
 *
 * Läuft als klassisches Skript (Content-Script, Service Worker, Extension-Seiten)
 * und als CommonJS-Modul (Tests).
 */
(function (root) {
  'use strict';

  const FUZZY_MIN_LEN = 6;

  function normalize(str) {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function tokenize(str) {
    const n = normalize(str);
    return n ? n.split(' ') : [];
  }

  /** Levenshtein-Distanz mit frühem Abbruch, sobald sie > max ist. */
  function withinDistance(a, b, max) {
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > max) return false;
    if (a === b) return true;
    let prev = new Array(lb + 1);
    let cur = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      cur[0] = i;
      let rowMin = cur[0];
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= lb; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return false;
      const t = prev; prev = cur; cur = t;
    }
    return prev[lb] <= max;
  }

  /** Enthält `hay` einen Teilstring mit Distanz <= 1 zu `needle`? */
  function fuzzyContains(hay, needle) {
    if (hay.includes(needle)) return true;
    const n = needle.length;
    for (let len = n - 1; len <= n + 1; len++) {
      if (len <= 0 || len > hay.length) continue;
      for (let i = 0; i + len <= hay.length; i++) {
        if (withinDistance(hay.substr(i, len), needle, 1)) return true;
      }
    }
    return false;
  }

  /**
   * Erstellt einen Matcher.
   * @param {string[]} keywords
   * @param {{partial?: boolean, fuzzy?: boolean}} opts
   * @returns {{find(text: string): (string|null), empty: boolean}}
   */
  function compile(keywords, opts) {
    opts = opts || {};
    const partial = !!opts.partial;
    const fuzzy = !!opts.fuzzy;
    const entries = [];
    const seen = new Set();
    for (const raw of keywords || []) {
      const label = String(raw).trim();
      const tokens = tokenize(label);
      if (!tokens.length) continue;
      const key = tokens.join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ label, tokens, joined: key, compact: tokens.join('') });
    }

    // Schneller Pfad: einwortige Begriffe, exakter Ganzwort-Abgleich über ein Set.
    const singleExact = new Map();
    for (const e of entries) if (e.tokens.length === 1) singleExact.set(e.tokens[0], e.label);

    function tokenEq(textTok, kwTok) {
      if (textTok === kwTok) return true;
      return fuzzy && kwTok.length >= FUZZY_MIN_LEN && withinDistance(textTok, kwTok, 1);
    }

    function tokenContains(textTok, kwTok) {
      if (textTok.includes(kwTok)) return true;
      return fuzzy && kwTok.length >= FUZZY_MIN_LEN && fuzzyContains(textTok, kwTok);
    }

    function find(text) {
      if (!entries.length || !text) return null;
      const toks = tokenize(text);
      if (!toks.length) return null;

      if (!partial) {
        for (const t of toks) {
          const hit = singleExact.get(t);
          if (hit) return hit;
        }
      }

      const joined = toks.join(' ');
      for (const e of entries) {
        const k = e.tokens;
        if (partial) {
          if (joined.includes(e.joined)) return e.label;
          // Silbentrennung/Zeilenumbruch aus OCR ("Fuß- ball") abfangen.
          if (joined.replace(/ /g, '').includes(e.compact)) return e.label;
          if (fuzzy) {
            if (k.length === 1) {
              for (const t of toks) if (tokenContains(t, k[0])) return e.label;
            } else if (matchSequence(toks, k, tokenEq)) {
              return e.label;
            }
          }
        } else {
          if (matchSequence(toks, k, tokenEq)) return e.label;
          // Zwei aufeinanderfolgende Token ergeben zusammen das Wort ("Fuß-ball").
          if (k.length === 1) {
            for (let i = 0; i + 1 < toks.length; i++) {
              if (tokenEq(toks[i] + toks[i + 1], k[0])) return e.label;
            }
          }
        }
      }
      return null;
    }

    function matchSequence(toks, k, eq) {
      for (let i = 0; i + k.length <= toks.length; i++) {
        let ok = true;
        for (let j = 0; j < k.length; j++) {
          if (!eq(toks[i + j], k[j])) { ok = false; break; }
        }
        if (ok) return true;
      }
      return false;
    }

    return { find, empty: entries.length === 0 };
  }

  const api = { normalize, tokenize, withinDistance, compile, FUZZY_MIN_LEN };
  root.SFMatch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
