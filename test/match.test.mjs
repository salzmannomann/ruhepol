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
