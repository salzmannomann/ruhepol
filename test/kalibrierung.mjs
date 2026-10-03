// Kalibrierung des Bedeutungs-Filters mit dem echten Modell (braucht "npm run fetch-model").
// Rechnet belastende und unbedenkliche Schlagzeilen gegen die Themen-Beschreibungen aller
// Vorschlagslisten und die neutralen Vergleichstexte und zeigt je Stufe Treffer/Fehltreffer.
// Aufruf: npm run kalibrieren
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, setSettings } from './e2e.mjs';

const here = dirname(fileURLToPath(import.meta.url));
if (!existsSync(join(here, '..', 'extension', 'vendor', 'models', 'Xenova', 'multilingual-e5-small', 'onnx', 'model_quantized.onnx'))) {
  console.error('Modell fehlt – zuerst "npm run fetch-model".');
  process.exit(1);
}

export const BELASTEND = [
  'Gletscher in den Alpen verlieren so viel Eis wie nie zuvor',
  'Forscher warnen: Meere erwärmen sich schneller als erwartet',
  'Rekordsommer: Wasserknappheit in Südeuropa verschärft sich',
  'Russische Truppen rücken im Osten der Ukraine vor',
  'Israel fliegt neue Angriffe im Libanon',
  'Drohnen treffen Kraftwerk, Millionen ohne Strom',
  'Flut in Kärnten: Dörfer von der Außenwelt abgeschnitten',
  'Bus stürzt in Schlucht – mehrere Tote',
  'Floods hit Central Europe, thousands evacuated',
  'Frau in Wohnung erstochen, Ehemann festgenommen',
  'Schüsse vor Synagoge: Täter auf der Flucht',
  'Neue Virusvariante breitet sich in Asien aus',
  'Autozulieferer streicht 3000 Jobs',
  'Neue KI kann Stimmen täuschend echt nachahmen',
  'Immer mehr Jugendliche leiden unter Angstzuständen',
  'Bekannter Schauspieler im Alter von 64 Jahren verstorben',
];
export const UNBEDENKLICH = [
  'Rapid gewinnt Derby gegen Austria mit 2:1',
  'Neues Café eröffnet am Naschmarkt',
  'Wetter: Sonniges Wochenende mit bis zu 25 Grad',
  'Wiener Philharmoniker spielen Open-Air-Konzert in Schönbrunn',
  'Rezept: So gelingt der perfekte Kaiserschmarrn',
  'Neue Straßenbahnlinie verbindet Floridsdorf und Donaustadt',
  'Apple stellt neues iPhone vor',
  'Gemeinde baut 300 leistbare Wohnungen',
  'Tipps für den Herbsturlaub in der Steiermark',
  'Museum zeigt Werke von Gustav Klimt',
  'Skispringer Kraft gewinnt in Planica',
  'Neue Radwege in Graz fertiggestellt',
  'Studie: Kaffee am Morgen macht wacher',
  'Bundespräsident empfängt Staatsgast',
  'Schulstart: Was Eltern wissen müssen',
  'Tiergarten Schönbrunn freut sich über Pandababy',
];

const { sw, close } = await launch();
try {
  await sw.evaluate(() => chrome.storage.local.remove('semModel'));
  await setSettings(sw, { keywords: [], presets: SFPresetsAll(), semantic: true });
  const res = await sw.evaluate(async ({ texts }) => {
    const settings = await SFSettings.load();
    const model = await semModelId();
    const ref = await semReference(settings, model);
    const vecs = await embedTexts(model, texts);
    return SFSemantic.LEVELS.map((lv) => vecs.map((v) => SFSemantic.decide(v, ref, model, lv)));
  }, { texts: BELASTEND.concat(UNBEDENKLICH) });
  ['vorsichtig', 'mittel', 'stark'].forEach((lv, li) => {
    const r = res[li];
    const hits = r.slice(0, BELASTEND.length).filter((x) => x.hide).length;
    const fp = r.slice(BELASTEND.length).filter((x) => x.hide).length;
    console.log(`${lv.padEnd(10)} erkannt ${hits}/${BELASTEND.length}, Fehltreffer ${fp}/${UNBEDENKLICH.length}`);
  });
  console.log('\nmittel im Detail (bad = Nähe zum Unerwünschten, good = Nähe zu Erwünschtem/Neutralem):');
  res[1].forEach((x, i) => {
    const t = BELASTEND.concat(UNBEDENKLICH)[i];
    console.log(`${i < BELASTEND.length ? 'B' : 'U'} ${x.hide ? 'weg ' : '    '} ${x.bad.toFixed(3)} ${x.good.toFixed(3)}  ${t}`);
  });

  // Gute Nachrichten trotz gesperrtem Thema
  const GUT = [
    'Solarstrom deckt erstmals die Hälfte des Strombedarfs', 'Ozonloch schließt sich schneller als erwartet',
    'Waffenstillstand hält: Familien kehren in ihre Dörfer zurück', 'Neues Medikament senkt Krebsrisiko deutlich',
    'Bergretter bergen verschütteten Skifahrer lebend aus Lawine', 'Arbeitslosigkeit sinkt auf Rekordtief',
    'Inflation geht weiter zurück', 'Forscher entwickeln wirksamen Impfstoff gegen Malaria',
    'Spendenrekord für die Hochwasseropfer in Kärnten', 'Gemeinden einigen sich auf Plan zum Gletscherschutz',
    'KI hilft Ärzten, Tumore früher zu erkennen', 'Erstmals seit Jahren keine Verkehrstoten an Ostern',
  ];
  const SCHLECHT = BELASTEND.concat(['Hitzewelle fordert erste Todesopfer', 'Inflation steigt erneut deutlich an',
    'Waffenruhe gebrochen: neue Angriffe auf Wohngebiete', 'Lawine verschüttet Skifahrer – Suche eingestellt']);
  console.log('\nGute Nachrichten trotz gesperrtem Thema (Ton):');
  await setSettings(sw, { positiveShow: true });
  for (const lv of ['vorsichtig', 'mittel', 'stark']) {
    await setSettings(sw, { positiveLevel: lv });
    const r = (await sw.evaluate((t) => toneScore(t), GUT.concat(SCHLECHT))).results;
    const tp = r.slice(0, GUT.length).filter((x) => x.positive).length;
    const fp = r.slice(GUT.length).filter((x) => x.positive).length;
    console.log(`${lv.padEnd(10)} gute gezeigt ${tp}/${GUT.length}, schlechte fälschlich gezeigt ${fp}/${SCHLECHT.length}`);
  }
} finally {
  await close();
}

function SFPresetsAll() {
  return ['ki', 'klima', 'krieg', 'terror', 'verbrechen', 'missbrauch', 'unglueck', 'tod', 'psyche', 'sucht',
    'diskriminierung', 'tierleid', 'krankheit', 'wirtschaft', 'krise'];
}
