/*
 * Lernfilter: kleiner Naive-Bayes-Klassifikator (wie bei Spamfiltern), der aus den
 * Bewertungen des Nutzers lernt, welche Inhalte er nicht sehen will.
 *
 * Klassen: 'b' = ausblenden, 'o' = will ich sehen.
 * Merkmale: normalisierte Wörter (ab 3 Zeichen, ohne Füllwörter) und Wortpaare.
 * Jedes Merkmal zählt pro Text nur einmal, damit lange Texte nicht dominieren.
 *
 * Das Modell wird komplett aus der Liste der Bewertungen abgeleitet und kann jederzeit
 * daraus neu berechnet werden (z. B. wenn eine Bewertung gelöscht wird).
 */
(function (root) {
  'use strict';

  const M = root.SFMatch || (typeof require === 'function' ? require('./match.js') : null);

  const MIN_EACH = 3; // mindestens so viele Bewertungen je Klasse ...
  const MIN_TOTAL = 10; // ... und insgesamt, bevor das Modell mitentscheidet
  const MAX_TEXT = 3000;

  // Häufige deutsche und englische Füllwörter (bereits normalisiert: ä→ae, ß→ss).
  const STOPWORDS = new Set((
    'aber alle allem allen aller alles als also am an ander andere anderen auch auf aus bei beim bereits bis bisher ' +
    'bin bist da dabei dadurch dafuer dagegen damit dann daran darauf daraus darf darueber das dass davon dazu dein ' +
    'deine dem den denen denn der deren des deshalb dessen die dies diese diesem diesen dieser dieses doch dort du ' +
    'durch eben ein eine einem einen einer eines einige einmal er erst es etwa etwas euch euer fuer gab gegen gibt ' +
    'ging hat hatte hatten hier hin hinter ich ihm ihn ihnen ihr ihre ihrem ihren ihrer im immer in indem ins ist ja ' +
    'jede jedem jeden jeder jetzt kann kein keine keinem keinen keiner koennen konnte machen macht man mehr mein meine ' +
    'mit muss nach neben nein nicht nichts noch nun nur ob oder ohne schon sehr sein seine seinem seinen seiner seit ' +
    'sich sie sind so soll sollen sollte sondern sowie ueber um und uns unser unter vom von vor waehrend war waren ' +
    'warum was weil weiter weitere welche welchem welchen welcher wenn wer werden wie wieder will wir wird wo wollen ' +
    'wurde wurden zu zum zur zwar zwei drei vier fuenf neue neuen neuer neues heute gestern morgen jahr jahre jahren ' +
    'prozent mehr dazu mehrere laut sagt sagte sei seien soll wegen bleibt gilt geht gehen kommt kommen steht stehen ' +
    'the and for are but not you all any can had her was one our out has have this that with from they will would ' +
    'there their what about which when your said into more some than then them these been also just over only'
  ).split(/\s+/));

  function features(text) {
    const toks = M.tokenize(String(text || '').slice(0, MAX_TEXT))
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
    const set = new Set(toks);
    for (let i = 0; i + 1 < toks.length; i++) set.add(toks[i] + '_' + toks[i + 1]);
    return [...set];
  }

  function emptyModel() {
    return { v: 1, docs: { b: 0, o: 0 }, f: {} };
  }

  /** Bewertung ins Modell aufnehmen (verändert das Modell). */
  function train(model, text, label) {
    if (label !== 'b' && label !== 'o') return model;
    const feats = features(text);
    if (!feats.length) return model;
    model.docs[label]++;
    const idx = label === 'b' ? 0 : 1;
    for (const f of feats) {
      const c = model.f[f] || (model.f[f] = [0, 0]);
      c[idx]++;
    }
    return model;
  }

  function build(ratings) {
    const m = emptyModel();
    for (const r of ratings || []) train(m, r.text, r.label);
    return m;
  }

  function ready(model) {
    if (!model || !model.docs) return false;
    const { b, o } = model.docs;
    return b >= MIN_EACH && o >= MIN_EACH && b + o >= MIN_TOTAL;
  }

  /**
   * Wahrscheinlichkeit, dass der Nutzer den Text NICHT sehen will.
   * Liefert {p, known} oder null, wenn das Modell noch zu wenig gelernt hat.
   * known = Anzahl der Merkmale, die das Modell schon kennt.
   */
  function score(model, text) {
    if (!ready(model)) return null;
    const { b, o } = model.docs;
    let sum = 0;
    let known = 0;
    for (const f of features(text)) {
      const c = model.f[f];
      if (!c) continue;
      known++;
      // Bernoulli-ähnlich mit Laplace-Glättung: Anteil der Texte je Klasse, die das Merkmal enthalten.
      sum += Math.log((c[0] + 1) / (b + 2)) - Math.log((c[1] + 1) / (o + 2));
    }
    if (!known) return { p: b / (b + o), known: 0 };
    // Naive Bayes ist bei vielen Merkmalen übertrieben sicher; dämpfen mit sqrt(Anzahl).
    const prior = Math.log(b / o);
    const logit = prior + (sum / Math.sqrt(known)) * 1.5;
    return { p: 1 / (1 + Math.exp(-logit)), known };
  }

  /** Merkmale mit dem stärksten Gewicht je Richtung (für die Übersicht in den Einstellungen). */
  function topFeatures(model, n) {
    const out = { b: [], o: [] };
    if (!model || !model.docs) return out;
    const { b, o } = model.docs;
    const list = [];
    for (const [f, c] of Object.entries(model.f)) {
      if (c[0] + c[1] < 2 || f.includes('_')) continue;
      const w = Math.log((c[0] + 1) / (b + 2)) - Math.log((c[1] + 1) / (o + 2));
      list.push([f, w, c]);
    }
    list.sort((x, y) => y[1] - x[1]);
    out.b = list.filter((x) => x[1] > 0).slice(0, n).map(([f, , c]) => ({ word: f, b: c[0], o: c[1] }));
    out.o = list.filter((x) => x[1] < 0).slice(-n).reverse().map(([f, , c]) => ({ word: f, b: c[0], o: c[1] }));
    return out;
  }

  const api = { STOPWORDS, features, emptyModel, train, build, ready, score, topFeatures, MIN_EACH, MIN_TOTAL };
  root.SFLearn = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
