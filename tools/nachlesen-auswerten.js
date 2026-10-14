// Auswertung von tools/bilder-nachlesen.mjs: node tools/nachlesen-auswerten.js .vergleich/bilder/nachlesen.json
// Regel: Bild mit Deutsch lesen; Zeilen mit unsicherem Wort (≥ minL Buchstaben, Sicherheit < 70) mit
// Deutsch+Englisch nachlesen; sind es mehr als maxZ Zeilen, das ganze Bild mit Deutsch+Englisch lesen.
// Verglichen mit Deutsch+Englisch (Stand 1.30.3): Gesamtzeit und verlorene Wörter (≥ 4 Buchstaben,
// Umlaute gleichgesetzt, weil das Deutsch-Modell „Österreich“ richtig liest, wo Englisch „Osterreich“ liest).
const { resolve } = require('node:path');
const O = require(resolve(process.argv[2]));
const sum = (a) => a.reduce((s, x) => s + x, 0);
const words = (s) => new Set(String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/\p{L}{4,}/gu) || []);
const ref = sum(O.map((x) => x.refMs)), de = sum(O.map((x) => x.deMs));
console.log(`${O.length} Bilder, ${O.filter((x) => words(x.ref).size).length} mit echtem Text`);
console.log('Deutsch+Englisch (1.30.3)', (ref / 1000).toFixed(1), 's; nur Deutsch', (de / 1000).toFixed(1), 's');

const rows = [];
for (const minL of [2, 3]) for (const minH of [0, 10, 14]) for (const maxZ of [1, 2, 3, 4, 6, 8, 1e9]) {
  let ms = 0, ganz = 0, zeilen = 0;
  const lost = [];
  for (const x of O) {
    const z = x.zeilen.filter((l) => l.h >= minH && l.words.some((w) => w.L >= minL && w.conf < 70));
    let text;
    if (z.length > maxZ) { ms += x.deMs + x.refMs; ganz++; text = x.ref; }
    else {
      ms += x.deMs + sum(z.map((l) => l.ms)); zeilen += z.length;
      const nach = new Set(z.map((l) => l.key));
      text = x.deLines.filter((l) => !nach.has(l.key)).map((l) => l.text).concat(z.map((l) => l.text)).join('\n');
    }
    const got = words(text);
    const l = [...words(x.ref)].filter((w) => !got.has(w));
    if (l.length) lost.push(l.join(' '));
  }
  rows.push({ minL, minH, maxZ: maxZ > 1e8 ? '∞' : maxZ, zeit_s: +(ms / 1000).toFixed(1), ganzesBild: ganz, zeilen, verloren: lost.length, lost: lost.slice(0, 5) });
}
rows.sort((a, b) => a.verloren - b.verloren || a.zeit_s - b.zeit_s);
for (const r of rows.slice(0, 15)) console.log(JSON.stringify(r));
