import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compile, normalize, withinDistance } = require('../extension/lib/match.js');
const S = require('../extension/lib/settings.js');

test('normalize: Umlaute, ß, Akzente, Groß/klein', () => {
  assert.equal(normalize('Fußball-Ärger'), 'fussball aerger');
  assert.equal(normalize('CAFÉ Über'), 'cafe ueber');
});

test('Ganzwort-Treffer, Umlaute gleichwertig', () => {
  const m = compile(['Fußball', 'Bürgermeister']);
  assert.equal(m.find('Heute: FUSSBALL im Fernsehen'), 'Fußball');
  assert.equal(m.find('Der Buergermeister sagt'), 'Bürgermeister');
  assert.equal(m.find('Fußballspiel'), null, 'Teilwort nur mit Option');
  assert.equal(m.find('Kein Treffer hier'), null);
});

test('Teilwort-Treffer optional', () => {
  const m = compile(['ball'], { partial: true });
  assert.equal(m.find('Das Fußballspiel'), 'ball');
});

test('Wortfolgen', () => {
  const m = compile(['Formel 1']);
  assert.equal(m.find('Die formel-1-Saison'), 'Formel 1');
  assert.equal(m.find('Formel und 1'), null);
});

test('Silbentrennung aus OCR', () => {
  const m = compile(['Bürgermeister']);
  assert.equal(m.find('Bürger-\nmeister tritt zurück'), 'Bürgermeister');
});

test('Unscharfer Abgleich: Distanz 1 ab 8 Zeichen, gleicher Anfangsbuchstabe, Standard aus', () => {
  assert.equal(compile(['Bürgermeister']).find('Burgermeisler'), null);
  const f = compile(['Bürgermeister', 'Hund', 'Skandal', 'Truppen', 'Explosion'], { fuzzy: true });
  assert.equal(f.find('Buergermeisler tritt'), 'Bürgermeister');
  assert.equal(f.find('Hand'), null, 'kurze Wörter nicht unscharf');
  assert.equal(f.find('Skandol'), null, 'unter 8 Zeichen nicht unscharf');
  assert.equal(f.find('Gruppen'), null, '„Gruppen“ ist nicht „Truppen“');
  assert.equal(f.find('Explosiom'), 'Explosion');
  assert.equal(f.find('Fxplosion'), null, 'Anfangsbuchstabe muss stimmen');
  assert.equal(f.find('Exxlosixn'), null, 'Distanz 2 kein Treffer');
  const fp = compile(['Explosion'], { fuzzy: true, partial: true });
  assert.equal(fp.find('Gasexplosiom'), 'Explosion');
});

test('withinDistance', () => {
  assert.ok(withinDistance('abcdef', 'abcdef', 1));
  assert.ok(withinDistance('abcdef', 'abcdf', 1));
  assert.ok(!withinDistance('abcdef', 'abdcfe', 1));
});

test('Seitenregeln', () => {
  const s = S.sanitize({ siteMode: 'all', siteList: ['https://www.orf.at/x'] });
  assert.deepEqual(s.siteList, ['orf.at']);
  assert.equal(S.isActiveOn(s, 'sport.orf.at'), false);
  assert.equal(S.isActiveOn(s, 'derstandard.at'), true);
  const only = S.sanitize({ siteMode: 'only', siteList: ['orf.at'] });
  assert.equal(S.isActiveOn(only, 'orf.at'), true);
  assert.equal(S.isActiveOn(only, 'example.com'), false);
  assert.deepEqual(S.toggleHost(only, 'example.com', true), ['orf.at', 'example.com']);
  assert.deepEqual(S.toggleHost(s, 'orf.at', true), []);
});

const { PRESETS, ALL_IDS, termsFor } = require('../extension/lib/presets.js');

test('Platzhalter: Wortanfang, Wortende, Wortteil', () => {
  const m = compile(['Klimawandel*', '*krieg', '*krise*']);
  assert.equal(m.find('Folgen des Klimawandels'), 'Klimawandels');
  assert.equal(m.find('Der Ukrainekrieg geht weiter'), 'Ukrainekrieg');
  assert.equal(m.find('Ukraine-Krieg'), 'Krieg');
  assert.equal(m.find('Regierungskrisengipfel'), 'Regierungskrisengipfel');
  assert.equal(m.find('Kriegsende'), null, '*krieg ist nur Wortende');
  const short = compile(['*e']);
  assert.equal(short.find('Hase'), null, 'zu kurzer Platzhalter-Kern gilt als ganzes Wort');
});

test('Vorschlagslisten: typische Treffer', () => {
  const m = compile(termsFor(ALL_IDS));
  const hits = [
    'Neues KI-Modell vorgestellt',
    'Wie künstliche Intelligenz die Arbeit verändert',
    'ChatGPT erhält Update',
    'Klimakrise: Gletscher schmelzen',
    'UNO warnt vor Folgen des Klimawandels',
    'Russland setzt Angriffe fort – Ukraine-Krieg',
    'Neue Luftangriffe im Gazastreifen',
    'Terroranschlag in Paris',
    'Mordprozess beginnt',
    'Schwerer Verkehrsunfall auf der A1',
    'Hochwasser in Niederösterreich',
    'Lawinengefahr steigt',
    'Teuerung bleibt hoch',
    'Insolvenz bei Möbelhändler',
    'Corona-Zahlen steigen',
    'Regierungskrise in Wien',
    'Zwei Tote bei Brand',
    'Schüsse auf Polizisten in Linz',
    'Mann in Wohnung erschossen',
    'Firmenpleite: 300 Jobs weg',
  ];
  for (const t of hits) assert.ok(m.find(t), `kein Treffer: ${t}`);
});

test('Vorschlagslisten: keine typischen Fehltreffer', () => {
  const m = compile(termsFor(ALL_IDS));
  const misses = [
    'Kino-Tipp für das Wochenende',
    'Skifahren am Arlberg',
    'Kinder lernen schwimmen',
    'Neue Klimaanlage im Büro',
    'Das Klimaticket wird billiger',
    'Österreich gewinnt gegen Italien',
    'Rezept: Apfelstrudel mit Vanillesauce',
    'Leichtathletik-EM: Gold für Österreich',
    'Wir kriegen das schon hin',
    'Ski-Weltcup in Kitzbühel',
    'Konzert der Wiener Philharmoniker',
    'Bombenstimmung beim Fest',
    'Wetter: sonnig und mild',
    'Neue Wohnungen am Stadtrand',
    'Warum im Kosovo-Spiel so viele Schüsse vorbeigegangen sind',
    'Pleite gegen Salzburg: Austria verliert 0:3',
    'Drama in der Nachspielzeit',
    'Schock für Sturm: Kapitän verletzt',
    'Konzertkritik: Großer Applaus in der Staatsoper',
  ];
  for (const t of misses) assert.equal(m.find(t), null, `Fehltreffer: ${t} → ${m.find(t)}`);
});

test('Vorschlagslisten: eindeutige IDs, keine leeren Begriffe', () => {
  assert.equal(new Set(ALL_IDS).size, PRESETS.length);
  for (const p of PRESETS) for (const t of p.terms) assert.ok(require('../extension/lib/match.js').parseTerm(t).length, t);
});

test('Leistung: 300 Begriffe, 5000 Texte', () => {
  const m = compile(termsFor(ALL_IDS));
  const t0 = performance.now();
  for (let i = 0; i < 5000; i++) m.find(`Meldung Nummer ${i}: Neue Entwicklungen in der Wirtschaft und Kultur des Landes`);
  const dt = performance.now() - t0;
  assert.ok(dt < 500, `${dt.toFixed(0)} ms`);
});

const L = require('../extension/lib/learn.js');

test('Nie-ausblenden-Liste', () => {
  const m = compile(['*krise'], { allow: ['Wohnungskrise', 'Midlife*'] });
  assert.equal(m.find('Die Wohnungskrise verschärft sich'), null);
  assert.equal(m.find('Midlife-Krise mit 40'), 'Krise', 'Bindestrich: "Krise" ist eigenes Wort');
  assert.equal(compile(['*krise'], { allow: ['Midlife-Krise'] }).find('Midlife-Krise mit 40'), null);
  assert.equal(m.find('Wohnungskrise und Klimakrise'), 'Klimakrise', 'andere Krise trifft weiterhin');
});

test('Lernfilter: unterscheidet nach Bewertungen', () => {
  const ratings = [
    ['Klimakrise: Gletscher schmelzen immer schneller', 'b'],
    ['UNO warnt vor Folgen der Klimakrise für Küsten', 'b'],
    ['Hitzerekord: Klimakrise verschärft Dürre in Europa', 'b'],
    ['CO2-Ausstoß steigt trotz Klimakrise weiter', 'b'],
    ['Klimagipfel endet ohne Einigung zur Klimakrise', 'b'],
    ['Wohnungskrise: Mieten in Wien steigen weiter', 'o'],
    ['Neue Wohnbauförderung gegen die Wohnungskrise', 'o'],
    ['Wohnungskrise trifft junge Familien besonders', 'o'],
    ['Gemeindebau: Stadt baut 5000 neue Wohnungen', 'o'],
    ['Mietpreisbremse soll Wohnungskrise lindern', 'o'],
  ].map(([text, label]) => ({ text, label }));
  const model = L.build(ratings);
  assert.ok(L.ready(model));
  const bad = L.score(model, 'Klimakrise bedroht Alpen-Gletscher');
  const good = L.score(model, 'Wohnungskrise: Was die neue Förderung bringt');
  assert.ok(bad.p > 0.8, `Klima ${bad.p}`);
  assert.ok(good.p < 0.2, `Wohnen ${good.p}`);
  const top = L.topFeatures(model, 5);
  assert.ok(top.b.some((x) => x.word === 'klimakrise'));
  assert.ok(top.o.some((x) => x.word === 'wohnungskrise'));
});

test('Lernfilter: ohne genug Bewertungen keine Entscheidung', () => {
  const m = L.build([{ text: 'Klimakrise', label: 'b' }, { text: 'Wohnen', label: 'o' }]);
  assert.equal(L.score(m, 'Klimakrise'), null);
});

const SEM = require('../extension/lib/semantic.js');

function norm(v) { const n = Math.hypot(...v); return v.map((x) => x / n); }

test('Bedeutungs-Filter: Entscheidung nach Abstand zu Unerwünschtem und Neutralem', () => {
  const klima = norm([1, 0.1, 0, 0]);
  const wohnen = norm([0, 1, 0.1, 0]);
  const kultur = norm([0, 0, 0.1, 1]);
  const ref = { b: [], o: [wohnen], anchors: [klima], neutral: [kultur] };
  assert.equal(SEM.decide(norm([0.95, 0.1, 0, 0.05]), ref, 'test/tiny', 'mittel').hide, true);
  assert.equal(SEM.decide(norm([0.1, 0.95, 0, 0]), ref, 'test/tiny', 'mittel').hide, false);
  assert.equal(SEM.decide(norm([0.05, 0, 0, 1]), ref, 'test/tiny', 'mittel').hide, false);
  // Grenzfall: halb Klima, halb Kultur → nur bei „stark“
  const mixed = norm([0.7, 0, 0, 0.6]);
  assert.equal(SEM.decide(mixed, ref, 'test/tiny', 'vorsichtig').hide, false);
  assert.equal(SEM.decide(mixed, ref, 'test/tiny', 'stark').hide, true);
  // Grenzfall knapp unter der Veto-Schwelle wird als „unsicher“ markiert (für Chromes Modell)
  const r = SEM.decide(norm([0.7, 0, 0, 0.6]), { ...ref, topics: [klima] }, 'test/tiny', 'mittel');
  assert.equal(typeof r.unsure, 'boolean');
  // Gegenprüfung ohne Themen und ohne „ausblenden“-Bewertungen: nie aufdecken
  const leer = { b: [], o: [], anchors: [], topics: [], neutral: [kultur] };
  assert.equal(SEM.decide(norm([0.05, 0, 0, 1]), leer, 'test/tiny', 'mittel').veto, false);
  assert.equal(SEM.decide(norm([0.05, 0, 0, 1]), { ...leer, topics: [klima] }, 'test/tiny', 'mittel').veto, true);
});

test('Bedeutungs-Filter: eigener Wunsch geht eingebauten neutralen Texten vor', () => {
  const wohnen = norm([0, 1, 0.1, 0]);
  const klima = norm([1, 0.1, 0, 0]);
  const text = norm([0, 1, 0.05, 0]);
  // Wohnen ist (wie im echten Modell „Wohnen und Alltag“) auch ein neutraler Vergleichstext.
  const base = { b: [], o: [], anchors: [klima, wohnen], topics: [klima, wohnen], neutral: [wohnen] };
  assert.equal(SEM.decide(text, base, 'test/tiny', 'mittel').hide, false, 'ohne Wunsch-Regel Gleichstand');
  assert.equal(SEM.decide(text, { ...base, wishNo: [wohnen], wishYes: [] }, 'test/tiny', 'mittel').hide, true);
  // „Will ich trotzdem sehen“ oder eine „anzeigen“-Bewertung hebt den Wunsch wieder auf
  assert.equal(SEM.decide(text, { ...base, wishNo: [wohnen], wishYes: [text] }, 'test/tiny', 'mittel').hide, false);
});

test('Bedeutungs-Filter: Vektoren kompakt speichern', () => {
  const v = norm([0.3, -0.5, 0.1, 0.8, -0.05]);
  const back = SEM.unpack(SEM.pack(v));
  assert.ok(SEM.cosine(v, back) > 0.999);
});

test('Ton: gute Nachricht im selben Thema erkennen, Themen ohne gute Seite nie', () => {
  const krieg = { topic: 'krieg', pos: norm([1, 0, 0, 0]), neg: norm([0, 1, 0, 0]) };
  const tod = { topic: 'tod', pos: null, neg: norm([0, 0, 1, 0]) };
  assert.equal(SEM.tone(norm([0.9, 0.2, 0, 0]), [krieg, tod], 'test/tiny', 'mittel').positive, true);
  assert.equal(SEM.tone(norm([0.2, 0.9, 0, 0]), [krieg, tod], 'test/tiny', 'mittel').positive, false);
  const t = SEM.tone(norm([0.3, 0, 0.9, 0]), [krieg, tod], 'test/tiny', 'stark');
  assert.equal(t.topic, 'tod');
  assert.equal(t.positive, false);
});

test('Vorschlagslisten: Beispiel-Schlagzeilen je Thema für den Bedeutungs-Filter', () => {
  const P = require('../extension/lib/presets.js');
  for (const id of P.ALL_IDS) assert.ok(P.examplesFor([id]).length >= 2, id);
  assert.deepEqual(P.examplesFor([]), []);
  assert.ok(P.examplesFor(['klima']).every((t) => !P.examplesFor(['krieg']).includes(t)));
});

test('Zusammensetzen nur über Bindestrich, kurze Begriffe im Teilwort-Modus nur als Wort', () => {
  const m = compile(['Fußball', 'Überfall', 'Amok*', 'Notstand*', 'Heroin']);
  assert.equal(m.find('Fuß- ball'), 'Fußball');
  assert.equal(m.find('Fuß-\nball'), 'Fußball');
  assert.equal(m.find('Fuß ball'), null);
  assert.equal(m.find('entscheidet über Fall Müller'), null);
  assert.equal(m.find('Treffen am Oktoberfest'), null);
  assert.equal(m.find('Die Not stand im Vordergrund'), null);
  assert.equal(m.find('Hero in town'), null);
  const a = compile(['Fußball'], { allow: ['Zwischen'] });
  assert.equal(a.find('Fuß- ball'), 'Fußball', 'Bindestrich-Merker überlebt die Nie-Liste');
  const p = compile(['KI', 'Krieg'], { partial: true });
  assert.equal(p.find('Im Mai beim Kaiser'), null);
  assert.equal(p.find('KI-Modell'), 'KI');
  assert.equal(p.find('Weltkriege'), 'Krieg');
});

test('Zerlegte Umlaute (NFD) werden erkannt', () => {
  assert.ok(compile(['Mörder']).find('Der Mörder'.normalize('NFD')));
  assert.ok(compile(['Überdosis']).find('Überdosis'.normalize('NFD')));
});

test('Vorschlagslisten: Alltagswörter lösen nichts aus', () => {
  const P = require('../extension/lib/presets.js');
  const m = compile(P.termsFor(P.ALL_IDS));
  for (const t of ['Polizei sucht Zeugen', 'Firma sucht Mitarbeiter', 'Film von David Lynch']) assert.equal(m.find(t), null, t);
  assert.ok(m.find('Spielsucht ruiniert Familien'));
});

test('Krieg-Liste: Drohnen- und Raketenangriffe ohne Ortsnamen, zivile Drohnen/Raketen nicht', () => {
  const P = require('../extension/lib/presets.js');
  const m = compile(P.termsFor(['krieg']));
  for (const t of ['Brücke in Kyjiw erneut von Drohne getroffen', 'Nordkorea feuerte ballistische Rakete ab',
    'Zwei Tanker von Geschossen getroffen', 'Neue Drohnenattacken auf Raffinerie', 'Russland setzt Marschflugkörper ein']) {
    assert.ok(m.find(t), t);
  }
  for (const t of ['Drohnenshow begeistert beim Donauinselfest', 'Paket per Drohne geliefert', 'Rakete startet zur ISS',
    'Ukraine gewinnt Länderspiel gegen Island', 'Konzert in Kyjiw ausverkauft']) {
    assert.equal(m.find(t), null, t);
  }
});

test('Vorschlagslisten: eingebaute Ausnahmen (Toten Hosen, Rosenkrieg, Katastrophenübung)', () => {
  const P = require('../extension/lib/presets.js');
  const m = compile(P.termsFor(P.ALL_IDS), { allow: P.ALLOW });
  for (const t of ['Die Toten Hosen treten beim Nova Rock auf', 'Rosenkrieg in der neuen Sky-Serie',
    'Katastrophenübung: Bergstation in Vollbrand', 'Vermisste und zugelaufene Tiere']) {
    assert.equal(m.find(t), null, t);
  }
  assert.ok(m.find('Zahl der Toten steigt weiter'));
  assert.ok(m.find('Die Toten Hosen sagen Konzert ab, zwei Tote bei Unfall'), 'Ausnahme schützt nicht den Rest');
});

test('Bedeutungs-Filter: Teaser-Text bereinigen', () => {
  assert.equal(SEM.cleanText('Russland/Ukraine 276 Postings Brücke getroffen Livebericht Live'), 'Russland/Ukraine Brücke getroffen');
  assert.equal(SEM.cleanText('chronik 3.10. 11.29 Uhr Festnahme in Wien'), 'chronik Festnahme in Wien');
  assert.ok(!/APA|AFP|1:24/.test(SEM.cleanText('1:24 Schwere Überschwemmungen APA/AFP/Omar Al-Qattaa')));
  assert.equal(SEM.cleanText('Was ist euer Lieblingsbier? Mein Forum: Diskutieren Sie dieses Thema mit der STANDARD-Community Diskussion'), 'Was ist euer Lieblingsbier?');
});

test('Bedeutungs-Filter: Beispielsammlung fließt in die Entscheidung ein (echtes Modell)', () => {
  const E5 = 'Xenova/multilingual-e5-small';
  const a = norm([1, 0, 0, 0]), n = norm([0, 1, 0, 0]);
  // Text liegt knapp auf der Seite der Themen, die Beispiele sprechen klar dagegen
  const q = norm([0.52, 0.48, 0, 0.1]);
  const ref = { b: [], o: [], anchors: [a], topics: [a], neutral: [n] };
  const plain = SEM.decide(q, ref, E5, 'stark');
  const withEx = SEM.decide(q, { ...ref, exBad: [norm([1, 0, 0.3, 0])], exGood: [norm([0.3, 1, 0, 0.2]), q] }, E5, 'stark');
  assert.equal(withEx.hide, false);
  // umgekehrt: Beispiele bestätigen
  const q2 = norm([0.6, 0.4, 0, 0]);
  const conf = SEM.decide(q2, { ...ref, exBad: [q2], exGood: [n] }, E5, 'mittel');
  assert.equal(conf.hide, true);
  assert.equal(typeof plain.hide, 'boolean');
});

test('Beispielsammlung: je Thema mehrere belastende, genug harmlose Beispiele', () => {
  const E = require('../extension/lib/examples.js');
  const P = require('../extension/lib/presets.js');
  for (const id of P.ALL_IDS) assert.ok((E.BAD[id] || []).length >= 8, id);
  assert.ok(E.NEUTRAL.length >= 100);
  assert.deepEqual(E.badFor([]), []);
});

test('Echte Beispiele (real-vectors.json): zum Modell, zu den Testdaten und zu den Themen passend', async () => {
  const { createHash } = await import('node:crypto');
  const { readFileSync, existsSync } = await import('node:fs');
  const R = require('../extension/lib/real-vectors.json');
  const P = require('../extension/lib/presets.js');
  // Die eingestuften Teaser selbst liegen nicht im Repo (fremde Texte), nur lokal beim Entwickeln.
  const file = new URL('./fixtures/real-headlines.json', import.meta.url);
  if (existsSync(file)) {
    const A = JSON.parse(readFileSync(file, 'utf8')).daten.filter((x) => x.set === 'A' && x.y !== 'X');
    const hash = createHash('sha256').update(JSON.stringify(A.map((x) => [x.t, x.y]))).digest('hex').slice(0, 16);
    assert.equal(R.hash, hash, 'Testdaten geändert: npm run beispielvektoren');
    assert.equal(R.bad.length, A.filter((x) => x.y === 'B').length);
    assert.equal(R.good.length, A.filter((x) => x.y === 'U').length);
  }
  assert.equal(R.model, SEM.DEFAULT_MODEL);
  for (const b of R.bad) assert.ok(b.topics.length && b.topics.every((t) => P.ALL_IDS.includes(t)));
  // keine Texte im Paket, nur Vektoren
  assert.ok(!JSON.stringify(R).includes('Brücke'));
  const v = SEM.unpackScaled(R.good[0]);
  assert.equal(v.length, 384);
});

test('Lernfilter: bei ungleich vielen Bewertungen zählen „sehen“-Wörter nicht als „ausblenden“', () => {
  const L = require('../extension/lib/learn.js');
  const ratings = [];
  const bad = ['Neues KI-Modell ersetzt Jobs', 'KI-Chatbot erfindet Zitate', 'OpenAI stellt KI-Modell vor', 'KI-Modell schreibt Hausübungen',
    'Konzern setzt auf KI-Modell', 'KI-Modell erkennt Gesichter', 'Streit um KI-Modell', 'KI-Modell im Test', 'Regeln für KI-Modell', 'KI-Modell lernt Sprache'];
  bad.forEach((t) => ratings.push({ text: t, label: 'b' }));
  // 90 harmlose, jeweils mit eigenen Wörtern, die nur einmal vorkommen
  for (let i = 0; i < 90; i++) ratings.push({ text: `Gemeindefest${i} Sonntagsmarkt${i} Radweg${i} eröffnet`, label: 'o' });
  ratings.push({ text: 'Probealarm Sirenen Zivilschutz am Samstag', label: 'o' });
  const m = L.build(ratings);
  // Wörter, die einmal bei „sehen“ vorkamen, dürfen nicht Richtung „ausblenden“ zeigen
  const s1 = L.score(m, 'Probealarm: Sirenen beim Zivilschutz am Samstag getestet');
  assert.ok(!s1 || s1.p <= 0.5, JSON.stringify(s1));
  // echte Muster werden weiter erkannt
  const s2 = L.score(m, 'Neues KI-Modell vorgestellt');
  assert.ok(s2 && s2.p > 0.9, JSON.stringify(s2));
});

test('Kennenlernen: je Thema eine Schlagzeile, die nur die eigene Liste trifft; Grenzfälle ohne Treffer', () => {
  const P = require('../extension/lib/presets.js');
  const O = require('../extension/lib/onboarding.js');
  const m = Object.fromEntries(P.ALL_IDS.map((id) => [id, compile(P.termsFor([id]), { allow: P.ALLOW })]));
  assert.deepEqual(O.TOPIC_QUESTIONS.map((q) => q.topic).sort(), P.ALL_IDS.slice().sort(), 'neue Themenliste braucht eine Schlagzeile');
  for (const q of O.TOPIC_QUESTIONS) assert.deepEqual(P.ALL_IDS.filter((id) => m[id].find(q.text)), [q.topic], q.text);
  for (const q of O.BORDER_QUESTIONS) assert.deepEqual(P.ALL_IDS.filter((id) => m[id].find(q.text)), [], q.text);
  const qs = O.questions();
  assert.equal(qs.length, 20);
  assert.equal(new Set(qs).size, 20);
});

test('Kennenlernen: Auswahl und Stufe aus den Antworten', () => {
  const O = require('../extension/lib/onboarding.js');
  const qs = O.questions();
  const ans = (fn) => qs.map(fn);
  // nur Krieg und Terror belasten, Grenzfälle nicht
  let r = O.infer(ans((q) => q.topic === 'krieg' || q.topic === 'terror'), qs);
  assert.deepEqual(r.presets, ['krieg', 'terror']);
  assert.equal(r.level, null);
  // übersprungene Themen bleiben an, Grenzfälle überwiegend belastend → stark
  r = O.infer(ans((q) => (q.topic === 'ki' ? false : q.topic === null ? true : null)), qs);
  assert.equal(r.presets.length, 14);
  assert.ok(!r.presets.includes('ki'));
  assert.equal(r.level, 'stark');
  // zu wenige Grenzfälle beantwortet: Stufe unverändert
  let n = 0;
  r = O.infer(ans((q) => (q.topic === null ? (n++ < 2 ? true : null) : true)), qs);
  assert.equal(r.level, null);
  assert.equal(r.presets.length, 15);
});

test('Krieg und Verbrechen erkennen Todesmeldungen auch ohne die Liste „Unglücke“ (dort steht „Tote“)', () => {
  const P = require('../extension/lib/presets.js');
  const m = compile(P.termsFor(P.ALL_IDS.filter((id) => id !== 'unglueck')), { allow: P.ALLOW });
  assert.ok(m.find('Ukraine: Tote nach russischen Angriffen in Saporischschja'));
  assert.ok(m.find('Tote Frau in Wiener Stiegenhaus: Verdächtiger festgenommen'));
  assert.equal(m.find('Russische Angriffslust im Eishockey'), null);
  assert.equal(m.find('Frühstück im Stiegenhaus'), null);
});
