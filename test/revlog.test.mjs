// Unit-Tests: Speicher des Aufdeck-Protokolls (Grenzen, Zähler, Bewertung nachtragen).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const R = createRequire(import.meta.url)('../extension/lib/revlog.js');
const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 13, 12);

test('Protokoll: Einträge über 30 Tage und über 1000 fallen weg, die neuesten bleiben', () => {
  const log = R.empty();
  R.addEntries(log, [{ kind: 'aufgedeckt', id: 'alt', t: now - 31 * DAY }], now);
  assert.equal(log.entries.length, 0);
  const many = Array.from({ length: 1005 }, (_, i) => ({ kind: 'automatisch', id: 'e' + i, t: now - 1005 + i }));
  R.addEntries(log, many, now);
  assert.equal(log.entries.length, R.MAX_ENTRIES);
  assert.equal(log.entries[0].id, 'e5');
  assert.equal(log.entries.at(-1).id, 'e1004');
});

test('Protokoll: unbekannte Arten werden verworfen, übergroße Einträge verlieren den HTML-Ausschnitt', () => {
  const log = R.empty();
  R.addEntries(log, [
    { kind: 'irgendwas', id: 'x' },
    { kind: 'aufgedeckt', id: 'gross', dom: { path: 'main > article', html: 'x'.repeat(20000) } },
  ], now, { version: '1.30.0' });
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].dom.html, '');
  assert.equal(log.entries[0].dom.path, 'main > article');
  assert.equal(log.entries[0].version, '1.30.0');
});

test('Protokoll: Zähler je Tag und Seite werden addiert, alte Tage fallen weg', () => {
  const log = R.empty();
  R.addStats(log, 'orf.at', { seiten: 1, treffer: { krieg: 3, eigene: 1 }, aufgedeckt: { krieg: 1 } }, now);
  R.addStats(log, 'orf.at', { seiten: 1, treffer: { krieg: 2 }, unbekannt: 5 }, now);
  assert.deepEqual(log.stats['2026-10-13 orf.at'], { seiten: 2, treffer: { krieg: 5, eigene: 1 }, aufgedeckt: { krieg: 1 } });
  R.addStats(log, 'orf.at', { seiten: 1 }, now + 31 * DAY);
  assert.equal(log.stats['2026-10-13 orf.at'], undefined);
});

test('Protokoll: Bewertung wird an den passenden Eintrag gehängt', () => {
  const log = R.empty();
  R.addEntries(log, [{ kind: 'aufgedeckt', id: 'a', t: now }], now);
  assert.equal(R.patch(log, 'a', { bewertung: 'zeigen' }), true);
  assert.equal(R.patch(log, 'fehlt', { bewertung: 'zeigen' }), false);
  assert.equal(log.entries[0].bewertung, 'zeigen');
});
