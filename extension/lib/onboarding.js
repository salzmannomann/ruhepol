/*
 * Kennenlernen beim ersten Start: kurze, sachliche Beispiel-Schlagzeilen (erfunden, ohne Namen),
 * aus deren Einstufung Ruhepol die Themenauswahl und die Empfindlichkeit ableitet.
 *
 * Gemessen (Persona-Simulation, echte Teaser): Die Themenauswahl ist der größte Hebel. Wer nicht
 * alle Themen ausblenden will, hat mit „alle Themen“ (Standard) bis zu sechsmal so viele
 * Fehltreffer wie mit der passenden Auswahl; eine Schlagzeile je Thema findet sie fast immer.
 *
 * Klassisches Skript: stellt globalThis.SFOnboarding bereit (auch in Node für Tests).
 */
(function (root) {
  'use strict';

  // Eine Schlagzeile je Themenliste (Reihenfolge wie in lib/presets.js); jede trifft die eigene Liste.
  const TOPIC_QUESTIONS = [
    { topic: 'ki', text: 'Neues KI-Modell soll Bürojobs ersetzen können' },
    { topic: 'klima', text: 'Klimawandel: Gletscher schmelzen schneller als erwartet' },
    { topic: 'krieg', text: 'Raketenangriff auf Großstadt, Armee meldet Gegenoffensive' },
    { topic: 'terror', text: 'Anschlag in Innenstadt: Polizei sucht Täter' },
    { topic: 'verbrechen', text: 'Raubüberfall auf Juwelier: Täter flüchtig' },
    { topic: 'missbrauch', text: 'Prozess wegen sexuellen Missbrauchs in Jugendheim beginnt' },
    { topic: 'unglueck', text: 'Busunglück auf Autobahn: Viele Verletzte' },
    { topic: 'tod', text: 'Bekannter Schauspieler im Alter von 68 Jahren gestorben' },
    { topic: 'psyche', text: 'Studie: Immer mehr Jugendliche leiden an Depressionen' },
    { topic: 'sucht', text: 'Mehr Drogentote in Großstädten' },
    { topic: 'diskriminierung', text: 'Rassistische Hetze im Netz nimmt deutlich zu' },
    { topic: 'tierleid', text: 'Tierquälerei: Dutzende verwahrloste Hunde gerettet' },
    { topic: 'krankheit', text: 'Neue Virusvariante breitet sich in Europa aus' },
    { topic: 'wirtschaft', text: 'Rezession droht: Firma kündigt Massenentlassungen an' },
    { topic: 'krise', text: 'Korruptionsskandal erschüttert Landesregierung' },
  ];

  // Grenzfälle ohne Schlagwort: Wer die meisten davon nicht sehen will, bekommt die Stufe „stark“.
  const BORDER_QUESTIONS = [
    { topic: null, text: 'Rund 1.000 Hitzetote im vergangenen Sommer' },
    { topic: null, text: 'Grippeimpfung: Lieferprobleme bei Impfstoff' },
    { topic: null, text: 'Proteste an Schulen: Hunderte Festnahmen' },
    { topic: null, text: 'Landeswährung im Sinkflug, Preise steigen stark' },
    { topic: null, text: 'Regierungspartei streitet offen über Führung' },
  ];

  /** Fragen in Anzeige-Reihenfolge: Grenzfälle verteilt, damit es nicht nach Themenliste wirkt. */
  function questions() {
    const out = [];
    const step = Math.ceil(TOPIC_QUESTIONS.length / BORDER_QUESTIONS.length);
    TOPIC_QUESTIONS.forEach((q, i) => {
      out.push(q);
      if ((i + 1) % step === 0 && BORDER_QUESTIONS[(i + 1) / step - 1]) out.push(BORDER_QUESTIONS[(i + 1) / step - 1]);
    });
    for (const b of BORDER_QUESTIONS) if (!out.includes(b)) out.push(b);
    return out;
  }

  /**
   * answers: Array gleicher Länge wie questions(), je true („nicht sehen“), false („okay“) oder
   * null (übersprungen). Liefert {presets, level}: Themen bleiben an, wenn sie als
   * belastend markiert oder übersprungen wurden; level ist 'stark' oder null (= unverändert).
   */
  function infer(answers, qs) {
    qs = qs || questions();
    const off = new Set();
    let borderYes = 0, borderAnswered = 0;
    qs.forEach((q, i) => {
      const a = answers[i];
      if (a !== true && a !== false) return;
      if (q.topic === null) { borderAnswered++; if (a) borderYes++; return; }
      if (a === false) off.add(q.topic);
    });
    const presets = TOPIC_QUESTIONS.map((q) => q.topic).filter((id) => !off.has(id));
    const level = borderAnswered >= 3 && borderYes / borderAnswered > 0.5 ? 'stark' : null;
    return { presets, level };
  }

  root.SFOnboarding = { TOPIC_QUESTIONS, BORDER_QUESTIONS, questions, infer };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SFOnboarding;
})(typeof globalThis !== 'undefined' ? globalThis : this);
