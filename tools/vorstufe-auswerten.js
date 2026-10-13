// Auswertung von tools/bilder-vorstufe.mjs:
//   node tools/vorstufe-auswerten.js .vergleich/bilder/vorstufe-deu+eng.json [.vergleich/bilder/vorstufe-deu.json]
// 1. Zeiten: volle Texterkennung, nur Seitenaufteilung (volle und halbe Größe), Bild nur übergeben.
// 2. Mit zweiter Datei: Was ändert sich (z. B. nur Deutsch statt Deutsch+Englisch): Zeit, gelesene Wörter.
// 3. Vorstufe: Bild freigeben, wenn die Seitenaufteilung keine Zeile mit genug Zeichen findet.
//    Gezählt: übersprungene Bilder, gesparte Zeit, verpasste Bilder mit echtem Text.
const { resolve } = require('node:path');
const A = require(resolve(process.argv[2]));
const B = process.argv[3] ? require(resolve(process.argv[3])) : null;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const sum = (a) => a.reduce((s, x) => s + x, 0);
const t = (x, k) => med(x[k]);
const words = (s) => new Set((String(s).toLowerCase().match(/\p{L}{4,}/gu) || []));
const rel = (x) => words(x.text).size > 0; // echter Text: mindestens ein Wort mit 4 Buchstaben

function zeiten(name, o) {
  console.log(`\n== ${name}: ${o.length} Bilder, ${o.filter(rel).length} mit echtem Text`);
  for (const k of ['voll', 'layout', 'layoutHalb', 'leer']) {
    const v = o.map((x) => t(x, k));
    console.log(k.padEnd(11), 'Median', med(v).toFixed(0).padStart(5), 'ms  Summe', (sum(v) / 1000).toFixed(1).padStart(6), 's');
  }
}
zeiten(process.argv[2], A);

if (B) {
  zeiten(process.argv[3], B);
  const byId = new Map(B.map((x) => [x.id, x]));
  let lost = 0, gained = 0, lostImg = [], fasterN = 0;
  for (const a of A) {
    const b = byId.get(a.id); if (!b) continue;
    const wa = words(a.text), wb = words(b.text);
    const l = [...wa].filter((w) => !wb.has(w)), g = [...wb].filter((w) => !wa.has(w));
    lost += l.length; gained += g.length;
    if (l.length) lostImg.push({ id: a.id, nur_erste: l.join(' '), nur_zweite: g.join(' ') });
    if (t(b, 'voll') < t(a, 'voll')) fasterN++;
  }
  const both = A.filter((a) => byId.has(a.id));
  console.log('\nzweite Datei statt erster:', both.length, 'Bilder');
  console.log('  Zeit Summe', (sum(both.map((a) => t(a, 'voll'))) / 1000).toFixed(1), '→', (sum(both.map((a) => t(byId.get(a.id), 'voll'))) / 1000).toFixed(1), 's; schneller bei', fasterN);
  console.log('  Wörter (≥4 Buchst.) nur in der ersten gelesen', lost, '; nur in der zweiten', gained, '; Bilder mit Unterschied', lostImg.length);
  for (const x of lostImg) console.log('   ', JSON.stringify(x));
}

// Vorstufe auf der Datei, die zuletzt angegeben ist (so würde Ruhepol danach laufen)
const O = B || A;
const R = O.filter(rel);
function keep(lines, minSym, minH, maxH) {
  return (lines || []).some((l) => l.sym >= minSym && (l.y1 - l.y0) >= minH && (l.y1 - l.y0) <= maxH);
}
const rows = [];
for (const half of [false, true]) for (const minSym of [1, 2, 3, 4, 5, 6, 8, 10]) for (const minH of [0, 4, 6, 8]) for (const maxH of [1e9, 200, 120]) {
  const k = (x) => keep(half ? x.linesHalb : x.lines, minSym, half ? minH / 2 : minH, half ? maxH / 2 : maxH);
  const skipped = O.filter((x) => !k(x));
  const miss = R.filter((x) => !k(x));
  const cost = sum(O.map((x) => t(x, half ? 'layoutHalb' : 'layout')));
  const saved = sum(skipped.map((x) => t(x, 'voll')));
  rows.push({ half, minSym, minH, maxH, skip: skipped.length, miss: miss.length, netto_s: +((saved - cost) / 1000).toFixed(1), missT: miss.map((x) => x.text.replace(/\n/g, ' | ').slice(0, 40)) });
}
rows.sort((a, b) => a.miss - b.miss || b.netto_s - a.netto_s);
console.log('\nVorstufe (Gesamtzeit voll:', (sum(O.map((x) => t(x, 'voll'))) / 1000).toFixed(1), 's) – beste ohne verpasste Bilder:');
for (const r of rows.filter((r) => r.miss === 0).slice(0, 8)) console.log(' ', JSON.stringify({ halb: r.half, zeichen: r.minSym, minH: r.minH, maxH: r.maxH, übersprungen: r.skip, netto_s: r.netto_s }));
console.log('mit 1–2 verpassten:');
for (const r of rows.filter((r) => r.miss > 0 && r.miss <= 2).slice(0, 5)) console.log(' ', JSON.stringify({ halb: r.half, zeichen: r.minSym, minH: r.minH, übersprungen: r.skip, netto_s: r.netto_s, verpasst: r.missT }));
