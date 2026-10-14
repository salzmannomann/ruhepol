// Auswertung von tools/bilder-groesse.mjs: node tools/groesse-auswerten.js .vergleich/bilder/groesse.json
// Je Einstellung: Gesamtzeit und Bilder, in denen ein Wort (≥ 4 Buchstaben, Umlaute gleichgesetzt)
// fehlt, das die erste Einstellung (Stand in Ruhepol) liest.
const { resolve } = require('node:path');
const { SETS, out } = require(resolve(process.argv[2]));
const words = (s) => new Set(String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/\p{L}{4,}/gu) || []);
const base = SETS[0];
console.log(`${out.length} Bilder, ${out.filter((x) => words(x.r[base].text).size).length} mit echtem Text; Bezug ${base}`);
for (const s of SETS) {
  let ms = 0, lost = [], gained = 0;
  for (const x of out) {
    ms += x.r[s].ms;
    const a = words(x.r[base].text), b = words(x.r[s].text);
    const l = [...a].filter((w) => !b.has(w));
    gained += [...b].filter((w) => !a.has(w)).length;
    if (l.length) lost.push(l.join(' '));
  }
  console.log(s.padEnd(9), 'Zeit', (ms / 1000).toFixed(1).padStart(5), 's | Bilder mit verlorenen Wörtern', String(lost.length).padStart(2), '| neu gelesene Wörter', gained, lost.length ? '| ' + lost.slice(0, 6).join(' · ') : '');
}
