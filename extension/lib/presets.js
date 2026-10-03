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
      // Beschreibung für den Bedeutungs-Filter (Stufe 2): wird als Themen-Anker eingebettet.
      about: 'Künstliche Intelligenz, KI-Modelle, ChatGPT und Chatbots, Algorithmen ersetzen Menschen. Artificial intelligence, AI models, chatbots.',
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
      about: 'Klimawandel, Erderwärmung und Klimakrise: Gletscher schmelzen, Hitze und Dürre, CO2-Emissionen, steigender Meeresspiegel. Climate change, global warming.',
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
      about: 'Krieg, Soldaten und Panzer an der Front, Raketen und Luftangriffe, Bombardierung, zerstörte Städte, Kriegsopfer. War, military attack, missiles.',
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
      about: 'Terroranschlag, Attentat, Amoklauf, Geiselnahme, Schüsse und Explosion, Extremisten. Terror attack, shooting, extremists.',
      name: 'Terror und Gewalt',
      terms: [
        'Terror*', 'Anschlag', 'Anschlags', 'Anschläge*', 'Terroranschlag*', 'Bombenanschlag*',
        'Attentat*', 'Attentäter*', 'Amok*', 'Geiselnahme*', 'Geiseln', 'Islamist*', 'Dschihad*',
        'Extremist*', 'Rechtsextrem*', 'Linksextrem*', 'Messerangriff*', 'Messerattacke*',
        'Schießerei*', 'Schüsse auf', 'Schüsse gefallen', 'Schüsse abgegeben', 'Schüsse abgefeuert',
        'Schusswechsel', 'Schussverletzung*', 'erschossen', 'angeschossen', 'niedergeschossen', 'Schusswaffe*', 'Massaker*', 'Lynch*', 'Gewalttat*', 'Gewaltverbrechen',
        'Ausschreitung*', 'Krawalle',
      ],
    },
    {
      id: 'verbrechen',
      about: 'Mord, Tötung, Gewaltverbrechen, Leiche gefunden, Messerangriff, Raubüberfall, Entführung, Mordprozess. Murder, violent crime.',
      name: 'Verbrechen',
      terms: [
        'Mord', 'Morde', 'Mordes', 'Mordfall*', 'Mordprozess*', 'Mordversuch*', 'Mordanklage*', 'ermordet*',
        'Mörder*', 'Totschlag', 'Tötung*', 'getötet', 'Leiche', 'Leichen', 'Leichnam', 'Messerstecherei*',
        'Raubüberfall*', 'Überfall', 'Einbrecher*', 'Entführung*', 'entführt', 'Menschenhandel',
      ],
    },
    {
      id: 'missbrauch',
      about: 'Sexueller Missbrauch, Vergewaltigung, sexuelle Gewalt, Kindesmissbrauch, häusliche Gewalt gegen Frauen, Femizid. Sexual abuse, rape, domestic violence.',
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
      about: 'Schwerer Unfall, Absturz, Erdbeben, Überschwemmung, Hochwasser, Lawine, Waldbrand, Explosion, Tote und Verletzte. Disaster, accident, deaths.',
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
      about: 'Tod, Todesfall, gestorben, Trauer und Begräbnis, Nachruf, Suizid und Selbstmord. Death, grief, suicide.',
      name: 'Tod, Trauer, Suizid',
      terms: [
        'Tod', 'Todes', 'Todesfall*', 'tödlich*', 'gestorben', 'verstorben*', 'stirbt', 'starb',
        'Trauer*', 'Nachruf*', 'Begräbnis*', 'Beerdigung*', 'Suizid*', 'Selbstmord*', 'Sterbehilfe',
      ],
    },
    {
      id: 'psyche',
      about: 'Depression, Angststörung, Panikattacken, Essstörung, Magersucht, Selbstverletzung, Trauma, Burnout, psychische Krise. Mental illness, depression, anxiety.',
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
      about: 'Drogen, Überdosis, Heroin, Kokain, Fentanyl, Alkoholsucht, Spielsucht, Drogentote. Drugs, addiction, overdose.',
      name: 'Drogen und Sucht',
      terms: [
        'Drogen*', 'Drogentod*', 'Drogentote*', 'Überdosis', 'Heroin', 'Kokain', 'Crystal Meth', 'Fentanyl',
        'Opioid*', 'Sucht', 'süchtig*', 'Alkoholsucht', 'Alkoholiker*', 'Spielsucht', 'Glücksspielsucht',
        'Komasaufen', 'Entzug*', 'Rauschgift*',
      ],
    },
    {
      id: 'diskriminierung',
      about: 'Rassismus, Antisemitismus, Hassverbrechen, Hetze und Hasspostings, Homophobie, Sexismus, Diskriminierung, Mobbing. Racism, hate crime, discrimination.',
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
      about: 'Tierquälerei, Tierversuche, Massentierhaltung, Tiertransporte, Schlachthof, verendete Tiere. Animal cruelty, animal suffering.',
      name: 'Tierleid',
      terms: [
        'Tierquälerei', 'Tierquäler*', 'Tierversuch*', 'Massentierhaltung', 'Tiertransport*', 'Schlachthof*',
        'Wilderei', 'Wilderer', 'gekeult', 'Keulung*', 'Tierleid', 'verendet', 'Tiermisshandlung*',
      ],
    },
    {
      id: 'krankheit',
      about: 'Pandemie, Corona und Covid, Virus und Infektionen, Lockdown, Seuche, Epidemie, schwere Krankheit. Pandemic, virus, disease outbreak.',
      name: 'Pandemie und Krankheit',
      terms: [
        'Corona*', 'Covid*', 'Pandemie*', 'Epidemie*', 'Lockdown*', 'Impfpflicht', 'Vogelgrippe',
        'Schweinepest', 'Masern', 'Mpox', 'Affenpocken', 'Ebola', 'Cholera', 'Krebserkrankung*',
        'Krebstod', 'Seuche*', 'Infektionswelle*', 'Virusvariante*',
      ],
    },
    {
      id: 'wirtschaft',
      about: 'Wirtschaftskrise, Inflation und Teuerung, Rezession, Pleite und Insolvenz, Stellenabbau und Kündigungen, Börsencrash. Economic crisis, inflation, layoffs.',
      name: 'Wirtschaftskrise',
      terms: [
        'Inflation*', 'Teuerung*', 'Rezession*', 'Wirtschaftskrise*', 'Finanzkrise*', 'Energiekrise*',
        'Firmenpleite*', 'Pleitewelle*', 'pleitegegangen', 'Insolvenz*', 'Konkurs*', 'Stellenabbau*', 'Jobabbau*', 'Kündigungswelle*',
        'Massenentlassung*', 'Arbeitslosigkeit', 'Börsencrash*', 'Kurssturz*', 'Kurseinbruch*',
        'Staatsschulden', 'Sparpaket*', 'Strafzoll*', 'Strafzölle*', 'Zollstreit*', 'Handelskrieg*',
      ],
    },
    {
      id: 'krise',
      about: 'Krise, Skandal, Eskalation, Tragödie, Schock und Panik, Korruption, Notstand. Crisis, scandal, escalation.',
      name: 'Krisen und Skandale allgemein',
      terms: [
        '*krise', '*krisen', 'Skandal*', 'Eskalation*', 'eskaliert', 'Tragödie*',
        'Korruption*', 'Affäre', 'Bedrohung*', 'Notstand*', 'Alarmstufe*',
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

  function aboutFor(ids) {
    const set = new Set(ids || []);
    return PRESETS.filter((p) => set.has(p.id) && p.about).map((p) => p.about);
  }

  root.SFPresets = { PRESETS, ALL_IDS, termsFor, aboutFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SFPresets;
})(typeof globalThis !== 'undefined' ? globalThis : this);
