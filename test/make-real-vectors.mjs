// Erzeugt extension/lib/real-vectors.json: Vektoren der von Hand eingestuften echten Teaser
// (test/fixtures/real-headlines.json, nur Datensatz A) als zusätzliche Beispiele für den
// Bedeutungs-Filter. Ins Paket kommen nur Zahlen, keine Nachrichtentexte. Belastende Beispiele
// bekommen ein Thema (nächstes Thema der eigenen Beispielsammlung), damit sie nur wirken,
// wenn die Person dieses Thema gesperrt hat. Datensatz B bleibt für die Prüfung unberührt.
// Aufruf: npm run beispielvektoren   (braucht das echte Modell: npm run fetch-model)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, setSettings } from './e2e.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const S = require('../extension/lib/semantic.js');
const P = require('../extension/lib/presets.js');
const M = require('../extension/lib/match.js');
const E = require('../extension/lib/examples.js');

// Liegt nicht im Repo (fremde Texte); nur lokal beim Entwickeln vorhanden.
const fixture = readFileSync(join(here, 'fixtures', 'real-headlines.json'), 'utf8');
const A = JSON.parse(fixture).daten.filter((x) => x.set === 'A' && x.y !== 'X');
const hash = createHash('sha256').update(JSON.stringify(A.map((x) => [x.t, x.y]))).digest('hex').slice(0, 16);
const topicIds = Object.keys(E.BAD);
const exTexts = topicIds.flatMap((id) => E.BAD[id]);

const { sw, close } = await launch();
try {
  await sw.evaluate(() => chrome.storage.local.remove('semModel'));
  await setSettings(sw, { semantic: true });
  const { model, vecs } = await sw.evaluate(async (texts) => {
    const model = await semModelId();
    const out = [];
    for (let i = 0; i < texts.length; i += 64) out.push(...(await embedTexts(model, texts.slice(i, i + 64))).map((v) => Array.from(v)));
    return { model, vecs: out };
  }, A.map((x) => S.cleanText(x.t)).concat(exTexts));
  const real = vecs.slice(0, A.length).map((v) => Float32Array.from(v));
  const ex = vecs.slice(A.length).map((v) => Float32Array.from(v));
  const byTopic = {};
  let k = 0;
  for (const id of topicIds) byTopic[id] = E.BAD[id].map(() => ex[k++]);
  // Themen: Listen, deren Schlagwörter im Text vorkommen, plus das nächstliegende Thema der
  // Beispielsammlung. Ein Beispiel wirkt, sobald eines seiner Themen gesperrt ist.
  const matchers = Object.fromEntries(topicIds.map((id) => [id, M.compile(P.termsFor([id]), { allow: P.ALLOW })]));
  const topicsOf = (q, text) => {
    const set = new Set(topicIds.filter((id) => matchers[id].find(text)));
    let best = null, bestS = -2;
    for (const id of topicIds) { const s = S.topK(q, byTopic[id], 2); if (s > bestS) { bestS = s; best = id; } }
    set.add(best);
    return [...set];
  };
  const out = { model, quelle: 'test/fixtures/real-headlines.json (Datensatz A)', hash, bad: [], good: [] };
  A.forEach((x, i) => {
    if (x.y === 'B') out.bad.push({ topics: topicsOf(real[i], x.t), v: S.packScaled(real[i]) });
    else out.good.push(S.packScaled(real[i]));
  });
  writeFileSync(join(here, '..', 'extension', 'lib', 'real-vectors.json'), JSON.stringify(out));
  const count = {};
  out.bad.forEach((b) => b.topics.forEach((t) => { count[t] = (count[t] || 0) + 1; }));
  console.log(`real-vectors.json: ${out.bad.length} belastende, ${out.good.length} harmlose (${model}); Themen:`, JSON.stringify(count));
} finally {
  await close();
}
