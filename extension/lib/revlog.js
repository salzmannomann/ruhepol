/*
 * Aufdeck-Protokoll (nur wenn in den Einstellungen eingeschaltet): was aufgedeckt, automatisch
 * wieder gezeigt, zu spät unscharf oder selbst ausgeblendet wurde, dazu Zählerstände je Seite und
 * Tag. Liegt nur in chrome.storage.local; weitergegeben wird es nur über „Protokoll exportieren“.
 * Klassisches Skript: stellt globalThis.SFRevlog bereit (und module.exports für Tests).
 */
(function (root) {
  'use strict';

  const MAX_ENTRIES = 1000;
  const MAX_DAYS = 30;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_ENTRY_CHARS = 8000;
  const KINDS = new Set(['aufgedeckt', 'automatisch', 'spaet', 'selbst-ausgeblendet', 'bewertet']);
  const STAT_KEYS = ['seiten', 'treffer', 'aufgedeckt', 'automatisch', 'spaet', 'selbst'];

  function empty() {
    return { entries: [], stats: {} };
  }

  function day(ts) {
    return new Date(ts).toISOString().slice(0, 10);
  }

  /** Alte Einträge (über 30 Tage) und Überzähliges (über 1000, die ältesten zuerst) entfernen. */
  function prune(log, now) {
    const cut = now - MAX_DAYS * DAY_MS;
    log.entries = log.entries.filter((e) => e && e.t >= cut).slice(-MAX_ENTRIES);
    const cutDay = day(cut);
    for (const k of Object.keys(log.stats)) if (k.slice(0, 10) < cutDay) delete log.stats[k];
    return log;
  }

  function clean(raw) {
    const log = empty();
    if (raw && Array.isArray(raw.entries)) log.entries = raw.entries.filter((e) => e && typeof e === 'object');
    if (raw && raw.stats && typeof raw.stats === 'object') log.stats = raw.stats;
    return log;
  }

  /** Einträge eines Tabs übernehmen; Unbekanntes und Übergroßes fällt weg. */
  function addEntries(log, entries, now, extra) {
    for (const e of entries || []) {
      if (!e || typeof e !== 'object' || !KINDS.has(e.kind)) continue;
      const entry = Object.assign({}, e, extra || {});
      entry.t = Number.isFinite(e.t) ? e.t : now;
      let json = JSON.stringify(entry);
      if (json.length > MAX_ENTRY_CHARS && entry.dom) {
        entry.dom = { path: String(entry.dom.path || '').slice(0, 600), html: '' };
        json = JSON.stringify(entry);
      }
      if (json.length > MAX_ENTRY_CHARS) continue;
      log.entries.push(entry);
    }
    return prune(log, now);
  }

  /** Zählerstände je Tag und Seite aufaddieren ({treffer: {liste: n}, aufgedeckt: n, …}). */
  function addStats(log, host, delta, now) {
    if (!host || !delta || typeof delta !== 'object') return log;
    const key = `${day(now)} ${String(host).slice(0, 100)}`;
    const s = log.stats[key] || (log.stats[key] = {});
    for (const k of STAT_KEYS) {
      const v = delta[k];
      if (Number.isFinite(v) && v > 0) s[k] = (s[k] || 0) + Math.min(v, 10000);
      else if (v && typeof v === 'object') {
        const sub = s[k] && typeof s[k] === 'object' ? s[k] : (s[k] = {});
        for (const [name, n] of Object.entries(v).slice(0, 50)) {
          if (Number.isFinite(n) && n > 0) sub[String(name).slice(0, 60)] = (sub[String(name).slice(0, 60)] || 0) + Math.min(n, 10000);
        }
      }
    }
    return prune(log, now);
  }

  /** Nachträgliche Bewertung (👍/👎) an einen Eintrag hängen. */
  function patch(log, id, fields) {
    const e = log.entries.find((x) => x.id === id);
    if (e) Object.assign(e, fields);
    return !!e;
  }

  const api = { MAX_ENTRIES, MAX_DAYS, empty, clean, prune, addEntries, addStats, patch };
  root.SFRevlog = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
