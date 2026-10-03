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
  // Gegenprüfung ohne Themen und ohne „ausblenden“-Bewertungen: nie aufdecken
  const leer = { b: [], o: [], anchors: [], topics: [], neutral: [kultur] };
  assert.equal(SEM.decide(norm([0.05, 0, 0, 1]), leer, 'test/tiny', 'mittel').veto, false);
  assert.equal(SEM.decide(norm([0.05, 0, 0, 1]), { ...leer, topics: [klima] }, 'test/tiny', 'mittel').veto, true);
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
