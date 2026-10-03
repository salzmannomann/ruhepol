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

test('Unscharfer Abgleich: Distanz 1 ab 6 Zeichen, Standard aus', () => {
  assert.equal(compile(['Bürgermeister']).find('Burgermeisler'), null);
  const f = compile(['Bürgermeister', 'Hund', 'Skandal'], { fuzzy: true });
  assert.equal(f.find('Buergermeisler tritt'), 'Bürgermeister');
  assert.equal(f.find('Hand'), null, 'kurze Wörter nicht unscharf');
  assert.equal(f.find('Skandol'), 'Skandal');
  assert.equal(f.find('Skxndxl'), null, 'Distanz 2 kein Treffer');
  const fp = compile(['Skandal'], { fuzzy: true, partial: true });
  assert.equal(fp.find('Riesenskondal'), 'Skandal');
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
  assert.equal(m.find('Folgen des Klimawandels'), 'Klimawandel');
  assert.equal(m.find('Der Ukrainekrieg geht weiter'), 'krieg');
  assert.equal(m.find('Ukraine-Krieg'), 'krieg');
  assert.equal(m.find('Regierungskrisengipfel'), 'krise');
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
