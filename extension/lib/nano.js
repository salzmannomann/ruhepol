/*
 * Chromes eingebautes Sprachmodell (Gemini Nano, Prompt API „LanguageModel“), falls vorhanden.
 * Läuft lokal im Browser; Chrome lädt das Modell selbst herunter. Fehlt es (zu schwacher Rechner,
 * zu wenig Speicher, ältere Chrome-Version), arbeitet Ruhepol ohne diese Funktionen weiter.
 *
 * Zwei Aufgaben:
 *  - judge(): zweite Meinung zu Grenzfällen („aktuelle belastende Meldung oder nur nebenbei?“)
 *  - assist(): Wunsch in eigenen Worten in Einstellungs-Änderungen übersetzen (Vorschau)
 *
 * Wird im Offscreen Document und auf der Einstellungsseite geladen.
 */
(function (root) {
  'use strict';

  const LANGS = [['de'], ['en']]; // Deutsch bevorzugt; ältere Modelle kennen nur Englisch

  function api() {
    return typeof root.LanguageModel !== 'undefined' ? root.LanguageModel : null;
  }

  function langOptions(langs) {
    return { expectedInputs: [{ type: 'text', languages: langs }], expectedOutputs: [{ type: 'text', languages: langs }] };
  }

  /** 'unavailable' | 'downloadable' | 'downloading' | 'available' */
  async function availability() {
    const LM = api();
    if (!LM) return 'unavailable';
    for (const langs of LANGS) {
      try {
        const a = await LM.availability(langOptions(langs));
        if (a !== 'unavailable') return a;
      } catch (_) { /* Sprache nicht unterstützt: nächste probieren */ }
    }
    return 'unavailable';
  }

  async function createSession(system, monitor) {
    const LM = api();
    if (!LM) throw new Error('nicht verfügbar');
    let lastErr = null;
    for (const langs of LANGS) {
      try {
        return await LM.create(Object.assign(langOptions(langs), {
          initialPrompts: [{ role: 'system', content: system }],
          monitor,
        }));
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('nicht verfügbar');
  }

  function parse(text) {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : text);
  }

  /* ---------------- Zweite Meinung zu Grenzfällen ---------------- */

  const JUDGE_SCHEMA = {
    type: 'object',
    properties: { urteil: { type: 'string', enum: ['belastend', 'harmlos'] } },
    required: ['urteil'],
  };

  function judgeSystem(ctx) {
    const lines = [
      'Du bist Teil eines Nachrichtenfilters, der belastende Meldungen unscharf stellt.',
      `Die Person möchte Meldungen zu diesen Themen nicht sehen: ${ctx.topics.join(', ') || '(keine Liste)'}.`,
    ];
    if (ctx.wishNo && ctx.wishNo.length) lines.push(`Außerdem nicht: ${ctx.wishNo.join('; ')}.`);
    if (ctx.wishYes && ctx.wishYes.length) lines.push(`Ausdrücklich trotzdem sehen will sie: ${ctx.wishYes.join('; ')}.`);
    lines.push(
      'Du bekommst einen Text, in dem ein Schlagwort zu einem dieser Themen vorkommt.',
      'Antworte "belastend", wenn der Text eine Meldung über ein solches Thema ist, die belasten kann.',
      'Antworte "harmlos", wenn das Thema nur nebenbei vorkommt (z. B. Sportbericht, historischer Rückblick,',
      'Kultur, Wortspiel) oder die Meldung klar positiv ist. Im Zweifel "belastend".',
      'Antworte nur mit JSON: {"urteil": "belastend"} oder {"urteil": "harmlos"}.',
    );
    return lines.join('\n');
  }

  /** Liefert je Text true (harmlos) / false (belastend). */
  async function judge(texts, ctx) {
    const base = await createSession(judgeSystem(ctx));
    const out = [];
    try {
      for (const text of texts) {
        const s = await base.clone(); // jeder Text für sich, ohne Verlauf der vorigen
        try {
          const r = parse(await s.prompt(String(text).slice(0, 1200), { responseConstraint: JUDGE_SCHEMA }));
          out.push(r.urteil === 'harmlos');
        } catch (_) {
          out.push(false); // unklare Antwort: unscharf lassen
        } finally {
          s.destroy();
        }
      }
    } finally {
      base.destroy();
    }
    return out;
  }

  /* ---------------- Assistent für Einstellungen ---------------- */

  const STR_LIST = { type: 'array', items: { type: 'string' } };
  const ASSIST_SCHEMA = {
    type: 'object',
    properties: {
      addKeywords: STR_LIST, removeKeywords: STR_LIST,
      addAllow: STR_LIST, removeAllow: STR_LIST,
      enablePresets: STR_LIST, disablePresets: STR_LIST,
      addWishNo: STR_LIST, addWishYes: STR_LIST,
      disableSites: STR_LIST, enableSites: STR_LIST,
      semanticLevel: { type: 'string', enum: ['', 'vorsichtig', 'mittel', 'stark'] },
      antwort: { type: 'string' },
    },
    required: ['antwort'],
  };

  function assistSystem(state) {
    return [
      'Du bist der Einstellungs-Assistent der Browser-Erweiterung "Ruhepol". Sie stellt belastende',
      'Nachrichten unscharf: über Schlagwörter, fertige Themenlisten und ein Sprachmodell.',
      'Übersetze den Wunsch der Person in Änderungen. Möglich sind NUR diese Felder:',
      '- addKeywords/removeKeywords: eigene Schlagwörter (einzelne Wörter; "Wort*" = Wortanfang).',
      '- addAllow/removeAllow: Wörter, die nie einen Treffer auslösen.',
      `- enablePresets/disablePresets: Themenlisten, nur diese IDs: ${state.presets.map((p) => `${p.id} (${p.name})`).join(', ')}.`,
      '- addWishNo: Themen in eigenen Worten, die die Person nicht sehen will (kurzer Satz).',
      '- addWishYes: Themen in eigenen Worten, die sie trotzdem sehen will (kurzer Satz).',
      '- disableSites/enableSites: Domains, auf denen Ruhepol aus- bzw. eingeschaltet wird (z. B. "orf.at").',
      '- semanticLevel: Empfindlichkeit des Sprachmodells, "vorsichtig", "mittel" oder "stark" (leer = unverändert).',
      'Eine Einstellung je Website gibt es nicht. Erfinde keine anderen Felder.',
      'Nutze für feine Themenwünsche lieber addWishNo/addWishYes als viele Schlagwörter.',
      'Schreibe in "antwort" auf Deutsch in ein bis zwei Sätzen, was du änderst, oder was nicht geht.',
      `Aktuell: eigene Schlagwörter: ${state.keywords.join(', ') || 'keine'}; nie ausblenden: ${state.allow.join(', ') || 'nichts'};`,
      `aktive Listen: ${state.active.join(', ') || 'keine'}; Empfindlichkeit: ${state.semanticLevel}.`,
      'Antworte nur mit JSON.',
    ].join('\n');
  }

  async function assist(request, state, monitor) {
    const s = await createSession(assistSystem(state), monitor);
    try {
      return parse(await s.prompt(String(request).slice(0, 1000), { responseConstraint: ASSIST_SCHEMA }));
    } finally {
      s.destroy();
    }
  }

  root.SFNano = { availability, createSession, judge, assist, judgeSystem, assistSystem };
})(typeof globalThis !== 'undefined' ? globalThis : this);
