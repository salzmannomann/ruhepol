// Auswertung von tools/bilder-pruefen.mjs: node tools/bilder-auswerten.js .vergleich/bilder/eval.json [Mindestbuchstaben]
const { GRID, out } = require(require('node:path').resolve(process.argv[2]));
const MINL = +(process.argv[3] || 4);
const relRe = new RegExp(`\\p{L}{${MINL},}`, 'u');
const isRel = (x) => relRe.test(x.text);
const R = out.filter(isRel), N = out.filter((x) => !x.text.trim());
console.log('Bilder', out.length, 'relevanter Text (Wort ≥' + MINL + ' Buchst.)', R.length, 'ohne Text', N.length, 'Zeit Median ms', out.map(x=>x.ms).sort((a,b)=>a-b)[out.length>>1].toFixed(1), 'max', Math.max(...out.map(x=>x.ms)).toFixed(1));
const rows = [];
GRID.forEach((g, gi) => { for (const run of [1, 2, 3, 4, 5]) {
  const keep = (x) => x.runs[gi] >= run;
  const miss = R.filter((x) => !keep(x));
  const skipAll = out.filter((x) => !keep(x)).length;
  rows.push({ ...g, run, miss: miss.length, skip: skipAll, skipN: N.filter((x) => !keep(x)).length, missT: miss.map((x) => x.text.replace(/\n/g, ' | ').slice(0, 50)) });
} });
rows.sort((a, b) => a.miss - b.miss || b.skip - a.skip);
for (const r of rows.slice(0, 12)) console.log(JSON.stringify({ e: r.edge, s: r.stroke, c: r.cellStrokes, run: r.run, verpasst: r.miss, übersprungen: r.skip, ohneText: r.skipN }));
console.log('--- beste mit 1 verpasstem:'); for (const r of rows.filter(r=>r.miss===1).slice(0,3)) console.log(JSON.stringify({ e: r.edge, s: r.stroke, c: r.cellStrokes, run: r.run, übersprungen: r.skip, verpasst: r.missT }));
