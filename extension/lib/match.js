/*
 * Schlagwort-Abgleich.
 * - Groß-/Kleinschreibung egal, Umlaute normalisiert (ä=ae, ö=oe, ü=ue, ß=ss),
 *   sonstige Akzente entfernt (é=e).
 * - Standard: ganze Wörter (bzw. ganze Wortfolgen bei Begriffen mit Leerzeichen).
 * - Optional Teilwort-Treffer ("ball" findet "Fußballspiel").
 * - Optional unscharfer Abgleich für OCR-Fehler: Levenshtein-Distanz 1 bei Wörtern
 *   ab 6 Zeichen.
 * - Platzhalter je Wort: "Wort*" (Wortanfang), "*wort" (Wortende), "*wort*" (Wortteil).
 * - "Nie ausblenden"-Liste (opts.allow): passende Wörter werden vor dem Abgleich entfernt.
 *   "Wohnungskrise" in der Liste schützt also „Wohnungskrise“, aber ein Text mit
 *   „Wohnungskrise und Klimakrise“ trifft weiterhin über „Klimakrise“.
 *
 * Läuft als klassisches Skript (Content-Script, Service Worker, Extension-Seiten)
 * und als CommonJS-Modul (Tests).
 */
(function (root) {
  'use strict';

  const FUZZY_MIN_LEN = 6;
  const WILDCARD_MIN_LEN = 3; // kürzere Platzhalter-Kerne ("*e") würden fast alles treffen

  function normalize(str) {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function tokenize(str) {
    const n = normalize(str);
    return n ? n.split(' ') : [];
  }

  /**
   * Zerlegt einen Suchbegriff in Wort-Muster: {t: normalisiertes Wort, pre: Wortanfang genügt,
   * suf: Wortende genügt}. Platzhalter "*" am Anfang/Ende eines Wortes.
   */
  function parseTerm(label) {
    const out = [];
    for (const part of String(label).trim().split(/\s+/)) {
      if (!part) continue;
      const lead = part.startsWith('*');
      const trail = part.length > 1 && part.endsWith('*');
      const toks = tokenize(part);
      if (!toks.length) continue;
      const pats = toks.map((t) => ({ t, pre: false, suf: false }));
      if (lead && pats[0].t.length >= WILDCARD_MIN_LEN) pats[0].suf = true;
      const last = pats[pats.length - 1];
      if (trail && last.t.length >= WILDCARD_MIN_LEN) last.pre = true;
      out.push(...pats);
    }
    return out;
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
   * @param {{partial?: boolean, fuzzy?: boolean, allow?: string[]}} opts
   * @returns {{find(text: string): (string|null), empty: boolean}}
   */
  function compile(keywords, opts) {
    opts = opts || {};
    const partial = !!opts.partial;
    const fuzzy = !!opts.fuzzy;
    const allowList = [];
    for (const raw of opts.allow || []) {
      const pats = parseTerm(raw);
      if (pats.length) allowList.push(pats);
    }
    const entries = [];
    const seen = new Set();
    for (const raw of keywords || []) {
      const label = String(raw).trim().replace(/\*/g, '');
      const pats = parseTerm(raw);
      if (!pats.length) continue;
      const key = pats.map((p) => (p.suf ? '*' : '') + p.t + (p.pre ? '*' : '')).join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      const tokens = pats.map((p) => p.t);
      const plain = pats.every((p) => !p.pre && !p.suf);
      entries.push({ label, pats, tokens, plain, joined: tokens.join(' '), compact: tokens.join('') });
    }

    // Index nach dem ersten Wort-Muster, damit auch lange Listen (Vorschlagslisten mit
    // Hunderten Begriffen) pro Textknoten nur wenige Kandidaten prüfen müssen.
    const byExact = new Map(); // erstes Wort exakt
    const byPrefix = new Map(); // erstes Wort mit "Wort*": Schlüssel = erste 3 Zeichen
    const loose = []; // erstes Wort mit "*wort" oder "*wort*"
    for (const e of entries) {
      const p = e.pats[0];
      if (p.suf) loose.push(e);
      else if (p.pre) push(byPrefix, p.t.slice(0, WILDCARD_MIN_LEN), e);
      else push(byExact, p.t, e);
    }
    function push(map, key, e) {
      const list = map.get(key);
      if (list) list.push(e); else map.set(key, [e]);
    }
    function candidates(tok) {
      const a = byExact.get(tok);
      const b = byPrefix.get(tok.slice(0, WILDCARD_MIN_LEN));
      if (!a && !b) return loose;
      return [].concat(a || [], b || [], loose);
    }

    function tokenEq(textTok, p) {
      const k = p.t;
      if (p.pre && p.suf) return textTok.includes(k);
      if (p.pre) return textTok.startsWith(k);
      if (p.suf) return textTok.endsWith(k);
      if (textTok === k) return true;
      return fuzzy && k.length >= FUZZY_MIN_LEN && withinDistance(textTok, k, 1);
    }

    function tokenContains(textTok, p) {
      if (textTok.includes(p.t)) return true;
      return fuzzy && p.t.length >= FUZZY_MIN_LEN && fuzzyContains(textTok, p.t);
    }

    function seqAt(toks, i, k) {
      if (i + k.length > toks.length) return false;
      for (let j = 0; j < k.length; j++) if (!tokenEq(toks[i + j], k[j])) return false;
      return true;
    }

    function matchSequence(toks, k) {
      for (let i = 0; i + k.length <= toks.length; i++) if (seqAt(toks, i, k)) return true;
      return false;
    }

    /** Anzeigename: bei Platzhaltern das tatsächlich gefundene Wort ("Klimakrise" statt "krise"). */
    function shown(e, words) {
      if (e.plain) return e.label;
      const w = words.join(' ');
      return w.charAt(0).toUpperCase() + w.slice(1);
    }

    function findIndexed(toks) {
      for (let i = 0; i < toks.length; i++) {
        for (const e of candidates(toks[i])) if (seqAt(toks, i, e.pats)) return shown(e, toks.slice(i, i + e.pats.length));
      }
      // Zwei aufeinanderfolgende Wörter ergeben zusammen den Begriff ("Fuß-ball", OCR-Trennung).
      for (let i = 0; i + 1 < toks.length; i++) {
        const c = toks[i] + toks[i + 1];
        for (const e of candidates(c)) if (e.pats.length === 1 && tokenEq(c, e.pats[0])) return shown(e, [c]);
      }
      return null;
    }

    function allowEq(textTok, p) {
      if (p.pre && p.suf) return textTok.includes(p.t);
      if (p.pre) return textTok.startsWith(p.t);
      if (p.suf) return textTok.endsWith(p.t);
      return textTok === p.t;
    }

    /** Entfernt Wörter/Wortfolgen der "Nie ausblenden"-Liste. */
    function stripAllowed(toks) {
      const drop = new Uint8Array(toks.length);
      let any = false;
      for (const pats of allowList) {
        for (let i = 0; i + pats.length <= toks.length; i++) {
          let ok = true;
          for (let j = 0; j < pats.length; j++) if (!allowEq(toks[i + j], pats[j])) { ok = false; break; }
          if (ok) { for (let j = 0; j < pats.length; j++) drop[i + j] = 1; any = true; }
        }
      }
      return any ? toks.filter((_, i) => !drop[i]) : toks;
    }

    function find(text) {
      if (!entries.length || !text) return null;
      let toks = tokenize(text);
      if (allowList.length) toks = stripAllowed(toks);
      if (!toks.length) return null;

      if (!partial && !fuzzy) return findIndexed(toks);

      const joined = toks.join(' ');
      const compact = joined.replace(/ /g, '');
      for (const e of entries) {
        const k = e.pats;
        if (partial) {
          if (joined.includes(e.joined)) return e.label;
          // Silbentrennung/Zeilenumbruch aus OCR ("Fuß- ball") abfangen.
          if (compact.includes(e.compact)) return e.label;
          if (k.length === 1) {
            for (const t of toks) if (tokenContains(t, k[0])) return e.label;
          } else if (matchSequence(toks, k)) {
            return e.label;
          }
        } else {
          if (matchSequence(toks, k)) return e.label;
          if (k.length === 1) {
            for (let i = 0; i + 1 < toks.length; i++) {
              if (tokenEq(toks[i] + toks[i + 1], k[0])) return e.label;
            }
          }
        }
      }
      return null;
    }

    return { find, empty: entries.length === 0 };
  }

  const api = { normalize, tokenize, parseTerm, withinDistance, compile, FUZZY_MIN_LEN };
  root.SFMatch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
