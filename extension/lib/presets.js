/*
 * Vorschlagslisten (vorwiegend negative Themen), nach Kategorien.
 *
 * Schreibweise:
 *   Wort      ganzes Wort (Groß/klein und Umlaute egal: „Unfälle“ = „Unfaelle“)
 *   Wort*     Wortanfang  („Klimawandel*“ findet „Klimawandels“, „Klimawandelfolgen“)
 *   *wort     Wortende    („*krieg“ findet „Ukrainekrieg“, „Bürgerkrieg“)
 *   *wort*    Wortteil
 *   A B       Wortfolge („künstliche Intelligenz“); Platzhalter gehen auch je Wort.
 *
 * Bindestriche trennen Wörter: „KI-Modell“ enthält das Wort „KI“, „Ukraine-Krieg“ das Wort „Krieg“.
 * Bewusst weggelassen sind Begriffe mit vielen Fehltreffern, z. B. „Klima*“ (Klimaanlage,
 * Klimaticket), „Krebs“ (Sternzeichen), „Bombe*“ (Bombenstimmung), „Angriff“ (Sport).
 */
(function (root) {
  'use strict';

  const PRESETS = [
    {
      id: 'ki',
      name: 'Künstliche Intelligenz',
      terms: [
        'KI', 'AI', 'künstliche Intelligenz', 'künstlicher Intelligenz', 'artificial intelligence',
        'ChatGPT', 'OpenAI', 'GPT', 'Chatbot*', 'Deepfake*', 'Sprachmodell*', 'LLM', 'LLMs',
        'Midjourney', 'maschinelles Lernen', 'machine learning', 'Deep Learning',
        'neuronale* Netz*', 'generative* KI', 'Superintelligenz', 'AGI',
      ],
    },
    {
      id: 'klima',
      name: 'Klimawandel',
      terms: [
        'Klimawandel*', 'Klimakrise*', 'Klimakatastrophe*', 'Klimaerwärmung', 'Erderwärmung',
        'globale* Erwärmung', 'Klimaschutz*', 'Klimaziel*', 'Klimagipfel*', 'Klimakonferenz*',
        'Klimapolitik', 'Klimaaktivist*', 'Klimakleber*', 'Klimaprotest*', 'Klimaforsch*',
        'klimaneutral*', 'Klimaneutralität', 'Klimarat', 'Klimabonus', 'Klimaflüchtling*',
        'Letzte Generation', 'Fridays for Future', 'CO2', 'Treibhausgas*', 'Treibhauseffekt',
        'Emissionen', 'Kipppunkt*', 'Gletscherschmelze', 'Meeresspiegel*', 'Pariser Klimaabkommen',
      ],
    },
    {
      id: 'krieg',
      name: 'Krieg und Militär',
      terms: [
        'Krieg', '*krieg', '*kriege', '*krieges', 'kriegs*', 'Luftangriff*',
        'Raketenangriff*', 'Drohnenangriff*', 'Raketenbeschuss', 'Beschuss', 'Bombardement*',
        'Bombardierung*', 'Bombenangriff*', 'Invasion', 'Militäroffensive*', 'Gegenoffensive*',
        'Militärschlag', 'Waffenstillstand*', 'Waffenruhe', 'Kampfhandlungen', 'Frontlinie*',
        'Truppen', 'Soldaten', 'Gefechte', 'Genozid', 'Völkermord', 'Gaza*', 'Hamas', 'Hisbollah',
        'Huthi*', 'Atomwaffe*', 'Atomkrieg*', 'Mobilmachung', 'Wehrpflicht',
      ],
    },
    {
      id: 'terror',
      name: 'Terror und Gewalt',
      terms: [
        'Terror*', 'Anschlag', 'Anschlags', 'Anschläge*', 'Terroranschlag*', 'Bombenanschlag*',
        'Attentat*', 'Attentäter*', 'Amok*', 'Geiselnahme*', 'Geiseln', 'Islamist*', 'Dschihad*',
        'Extremist*', 'Rechtsextrem*', 'Linksextrem*', 'Messerangriff*', 'Messerattacke*',
        'Schießerei*', 'Schüsse', 'Schusswaffe*', 'Massaker*', 'Lynch*', 'Gewalttat*', 'Gewaltverbrechen',
        'Ausschreitung*', 'Krawalle',
      ],
    },
    {
      id: 'verbrechen',
      name: 'Verbrechen',
      terms: [
        'Mord', 'Morde', 'Mordes', 'Mordfall*', 'Mordprozess*', 'Mordversuch*', 'Mordanklage*', 'ermordet*',
        'Mörder*', 'Totschlag', 'Tötung*', 'getötet', 'Leiche', 'Leichen', 'Leichnam', 'Messerstecherei*',
        'Raubüberfall*', 'Überfall', 'Einbrecher*', 'Entführung*', 'entführt', 'Menschenhandel',
      ],
    },
    {
      id: 'missbrauch',
      name: 'Missbrauch und sexuelle Gewalt',
      terms: [
        'Missbrauch*', 'missbraucht', 'Kindesmissbrauch*', 'Vergewaltig*', 'sexuelle* Übergriff*',
        'sexuelle* Gewalt', 'sexualisierte* Gewalt', 'sexuelle* Belästigung', 'Femizid*', 'häusliche* Gewalt',
        'Gewalt gegen Frauen', 'Kinderpornograf*', 'Kinderpornograph*', 'Missbrauchsdarstellung*', 'Grooming',
        'Stalking', 'Kinderschänder*', 'Pädophil*', 'Zwangsprostitution', 'K.-o.-Tropfen', 'Ko-Tropfen',
      ],
    },
    {
      id: 'unglueck',
      name: 'Unglücke und Katastrophen',
      terms: [
        'Unglück', 'Unglücks', 'Unfall*', 'Unfälle*', 'Verkehrsunfall*', 'Flugzeugabsturz*',
        'Zugunglück*', 'Busunglück*', 'Bergunglück*', 'Grubenunglück*', 'Erdbeben*', 'Nachbeben',
        'Tsunami*', 'Überschwemmung*', 'Hochwasser*', 'Flutkatastrophe*', 'Unwetter*', 'Lawine*',
        'Lawinenabgang', 'Murenabgang*', 'Mure', 'Muren', 'Erdrutsch*', 'Waldbrand*', 'Waldbrände*',
        'Großbrand*', 'Brandkatastrophe*', 'Explosion*', 'Hurrikan*', 'Taifun*', 'Tornado*',
        'Wirbelsturm*', 'Dürre*', 'Hitzewelle*', 'Katastrophe*', 'Todesopfer*', 'Tote', 'Toten',
        'Schwerverletzt*', 'Vermisste*', 'Großeinsatz',
      ],
    },
    {
      id: 'tod',
      name: 'Tod, Trauer, Suizid',
      terms: [
        'Tod', 'Todes', 'Todesfall*', 'tödlich*', 'gestorben', 'verstorben*', 'stirbt', 'starb',
        'Trauer*', 'Nachruf*', 'Begräbnis*', 'Beerdigung*', 'Suizid*', 'Selbstmord*', 'Sterbehilfe',
      ],
    },
    {
      id: 'psyche',
      name: 'Psychische Belastung',
      terms: [
        'Depression*', 'depressiv*', 'Angststörung*', 'Panikattacke*', 'Essstörung*', 'Magersucht',
        'magersüchtig*', 'Anorexie', 'Bulimie', 'Selbstverletz*', 'Burnout', 'Psychose*',
        'psychotisch*', 'Trauma', 'Traumata', 'traumatisiert*', 'PTBS', 'posttraumatisch*', 'Zwangsstörung*',
        'Einsamkeit', 'Psychiatrie*', 'Nervenzusammenbruch',
      ],
    },
    {
      id: 'sucht',
      name: 'Drogen und Sucht',
      terms: [
        'Drogen*', 'Drogentod*', 'Drogentote*', 'Überdosis', 'Heroin', 'Kokain', 'Crystal Meth', 'Fentanyl',
        'Opioid*', 'Sucht', 'süchtig*', 'Alkoholsucht', 'Alkoholiker*', 'Spielsucht', 'Glücksspielsucht',
        'Komasaufen', 'Entzug*', 'Rauschgift*',
      ],
    },
    {
      id: 'diskriminierung',
      name: 'Hass und Diskriminierung',
      terms: [
        'Rassismus', 'rassistisch*', 'Antisemitismus', 'antisemitisch*', 'Hassverbrechen', 'Hasskriminalität',
        'Hassrede', 'Hasspostings', 'Hetze', 'Homophobie', 'homophob*', 'Transfeindlich*', 'Queerfeindlich*',
        'Sexismus', 'sexistisch*', 'Frauenfeindlich*', 'Misogynie', 'Diskriminierung*', 'diskriminiert',
        'Fremdenfeindlich*', 'Islamfeindlich*', 'Mobbing', 'Cybermobbing', 'Shitstorm*',
      ],
    },
    {
      id: 'tierleid',
      name: 'Tierleid',
      terms: [
        'Tierquälerei', 'Tierquäler*', 'Tierversuch*', 'Massentierhaltung', 'Tiertransport*', 'Schlachthof*',
        'Wilderei', 'Wilderer', 'gekeult', 'Keulung*', 'Tierleid', 'verendet', 'Tiermisshandlung*',
      ],
    },
    {
      id: 'krankheit',
      name: 'Pandemie und Krankheit',
      terms: [
        'Corona*', 'Covid*', 'Pandemie*', 'Epidemie*', 'Lockdown*', 'Impfpflicht', 'Vogelgrippe',
        'Schweinepest', 'Masern', 'Mpox', 'Affenpocken', 'Ebola', 'Cholera', 'Krebserkrankung*',
        'Krebstod', 'Seuche*', 'Infektionswelle*', 'Virusvariante*',
      ],
    },
    {
      id: 'wirtschaft',
      name: 'Wirtschaftskrise',
      terms: [
        'Inflation*', 'Teuerung*', 'Rezession*', 'Wirtschaftskrise*', 'Finanzkrise*', 'Energiekrise*',
        'Pleite*', 'Insolvenz*', 'Konkurs*', 'Stellenabbau*', 'Jobabbau*', 'Kündigungswelle*',
        'Massenentlassung*', 'Arbeitslosigkeit', 'Börsencrash*', 'Kurssturz*', 'Kurseinbruch*',
        'Staatsschulden', 'Sparpaket*', 'Strafzoll*', 'Strafzölle*', 'Zollstreit*', 'Handelskrieg*',
      ],
    },
    {
      id: 'krise',
      name: 'Krisen und Skandale allgemein',
      terms: [
        '*krise', '*krisen', 'Skandal*', 'Eskalation*', 'eskaliert', 'Tragödie*', 'Schock*', 'Horror*',
        'Panik*', 'Drama', 'Dramen', 'Korruption*', 'Affäre', 'Bedrohung*', 'Notstand*', 'Alarmstufe*',
      ],
    },
  ];

  const ALL_IDS = PRESETS.map((p) => p.id);

  function termsFor(ids) {
    const set = new Set(ids || []);
    const out = [];
    for (const p of PRESETS) if (set.has(p.id)) out.push(...p.terms);
    return out;
  }

  root.SFPresets = { PRESETS, ALL_IDS, termsFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SFPresets;
})(typeof globalThis !== 'undefined' ? globalThis : this);
