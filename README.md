# Ruhepol

<img src="extension/icons/icon128.png" alt="" width="96" align="right">

Chrome-Erweiterung (Manifest V3), die belastende Inhalte sanft unscharf stellt – nach
Schlagwörtern, Themen und dem, was du ihr beibringst, auch wenn das Wort nur als Schrift
**im Bild** steht. (Früherer Arbeitstitel: „Schlagwortfilter“.) Die Texterkennung (OCR) läuft mit
[tesseract.js](https://github.com/naptha/tesseract.js) komplett lokal in der Erweiterung:
keine externen Server, keine CDNs. Einstellungen und Bewertungen werden höchstens über die
Chrome-Synchronisierung des eigenen Google-Kontos abgeglichen.

## Installation

Voraussetzung zum Bauen: [Node.js](https://nodejs.org/) ab Version 18.

1. Abhängigkeiten holen und das Paket fertigstellen:

   ```bash
   npm install
   npm run setup
   ```

   `npm run setup` erledigt drei Dinge:
   - kopiert tesseract.js und transformers.js (mit der WASM-Laufzeit von onnxruntime-web,
     ca. 27 MB) aus `node_modules` nach `extension/vendor/`;
   - lädt die Sprachdaten Deutsch und Englisch (`tessdata_fast`, ca. 6 MB) nach
     `extension/vendor/lang/`;
   - lädt das Sprachmodell für den Bedeutungs-Filter (`Xenova/multilingual-e5-small`,
     int8, ca. 135 MB mit Tokenizer) von Hugging Face nach `extension/vendor/models/`.

   Die Datei `.npmrc` schaltet Installationsskripte von Paketen ab. transformers.js zieht
   sonst onnxruntime-node mit, das beim Installieren Binärdateien nachlädt, die die
   Erweiterung nicht braucht.

   Wer den Bedeutungs-Filter nicht braucht, lässt den letzten Schritt weg:
   `npm run build && npm run fetch-lang`. Das Paket ist dann etwa 45 MB groß statt etwa
   180 MB.

2. In Chrome `chrome://extensions` öffnen.
3. Rechts oben den **Entwicklermodus** einschalten.
4. **Entpackte Erweiterung laden** anklicken und den Ordner **`extension`** in diesem
   Projekt auswählen (nicht den Projektordner selbst).
5. Optional: Das Puzzle-Symbol in der Symbolleiste anklicken und den Ruhepol
   anheften.

Nach Änderungen am Code auf `chrome://extensions` beim Ruhepol auf den
Neu-laden-Pfeil klicken und offene Tabs neu laden.

> **Update von 1.0.0 auf 1.1.0:** Ab 1.1.0 hat die Erweiterung eine feste Kennung (`key` im
> Manifest), damit die Synchronisierung zwischen Rechnern funktioniert. Chrome behandelt sie
> deshalb wie eine neue Erweiterung. Vorher in den Einstellungen unter „Sichern“ exportieren,
> dann die alte Version entfernen, die neue laden und die Datei wieder importieren.
> Die feste Kennung ist `ebmkpjpbmmjemfepkgbchdbafmmkaknp`.

## Bedienung

### Kennenlernen (beim ersten Start)

Nach der Installation öffnet sich eine kurze Seite mit 20 erfundenen, sachlichen
Schlagzeilen ohne Bilder: eine je Themenliste und fünf Grenzfälle ohne Schlagwort. Zu jeder
sagt man „Möchte ich nicht sehen“, „Ist okay für mich“ oder „Weiß nicht“. Daraus schlägt
Ruhepol die Themenauswahl vor:

- Themen, deren Schlagzeile als okay eingestuft wurde, werden abgeschaltet. Übersprungene
  Themen bleiben an.
- Wer die meisten Grenzfälle nicht sehen will, bekommt das Angebot, den Bedeutungs-Filter
  auf „stark“ zu stellen.

Vor dem Speichern lässt sich alles anpassen. Später erreicht man die Seite über
*Einstellungen → Themen → Mit Beispielen wählen …*. Sind über die Chrome-Synchronisierung
schon Einstellungen da (zweiter Rechner), öffnet sie sich nicht von selbst.

**Warum:** Die Themenauswahl ist der größte Hebel für wenige Fehler. Gemessen wurde das in
der Persona-Simulation an unabhängigen echten Teasern (Fehler = Fehltreffer + übersehene):

| Profil | alle Themen (Standard) | nach dem Kennenlernen | passende Auswahl |
|---|---|---|---|
| alle Themen belasten | 22 | 22 | 22 |
| nur Gewalt (Krieg, Terror, Verbrechen …) | 36 | 9 | 6 |
| nur Krieg und Terror | 62 | 21 | 10 |
| nur KI und Klima | 52 | 26 | 8 |
| alles außer KI | 34 | 16 | 16 |

Ebenfalls gemessen und **nicht** eingebaut: Eine Empfindlichkeit je Thema, die sich aus
Aufdecken+👍 und Rechtsklick-Sperren selbst nachstellt, war nicht besser als eine feste
Schwelle. Sie half einem Profil leicht und machte zwei andere deutlich schlechter.

### Popup (Klick auf das Symbol)

- **Filter aktiv**: schaltet die Erweiterung überall ein oder aus.
- **Auf dieser Seite**: schaltet den Filter nur für die aktuelle Domain ein oder aus
  (inklusive Subdomains).
- **Zähler**: Anzahl der ausgeblendeten Elemente auf der aktuellen Seite. Die Zahl steht
  auch als Plakette auf dem Symbol.
- **Einstellungen**: öffnet die Einstellungsseite.

### Einstellungen

Die Einstellungsseite ist in fünf Bereiche gegliedert und speichert jede Änderung sofort
(Textfelder kurz nach dem letzten Tastendruck):

| Bereich | Inhalt |
|---|---|
| **Themen** | Vorschlagslisten als Kacheln mit Schalter, eigene Schlagwörter, „Nie ausblenden“ |
| **Erkennung** | Lernfilter (Status, stärkste Wörter, letzte Bewertungen), Bedeutungs-Filter (KI), Schrift in Bildern |
| **Darstellung** | unscharf / Platzhalter / ausblenden, Aufdecken durch Gedrückthalten |
| **Seiten** | alle außer … / nur auf …, gesperrte Bereiche |
| **Erweitert** | Teilwort- und unscharfer Abgleich, Mindestbildgröße, Verhalten bei Bildfehlern, Cache, Export/Import, Gelerntes zurücksetzen |

Die einzelnen Optionen:

- **Schlagwörter**: ein Begriff pro Zeile. Groß-/Kleinschreibung ist egal, Umlaute werden
  gleich behandelt (`ä` = `ae`, `ö` = `oe`, `ü` = `ue`, `ß` = `ss`). Mehrere Wörter in
  einer Zeile müssen als Wortfolge vorkommen.
- **Platzhalter** für deutsche Wortformen und Zusammensetzungen:

  | Schreibweise | Bedeutung | Beispiel |
  |---|---|---|
  | `Wort` | ganzes Wort | `KI` findet „KI-Modell“, aber nicht „Kino“ |
  | `Wort*` | Wortanfang | `Klimawandel*` findet „Klimawandels“ |
  | `*wort` | Wortende | `*krieg` findet „Ukrainekrieg“, „Bürgerkrieg“ |
  | `*wort*` | Wortteil | `*skandal*` findet „Impfskandale“ |

  Bindestriche trennen Wörter: „Ukraine-Krieg“ enthält das Wort „Krieg“.
- **Auch Teilwörter finden**: Jeder Begriff gilt als Wortteil, „ball“ findet dann auch
  „Fußballspiel“. Das erzeugt deutlich mehr Fehltreffer, Platzhalter sind meist besser.
  Begriffe mit höchstens drei Buchstaben („KI“, „AI“) zählen weiter nur als ganzes Wort,
  sonst träfe „KI“ auch „Mai“ und „Kaiser“.
- **Nie ausblenden**: Begriffe, die nie einen Treffer auslösen, in derselben Schreibweise.
  Mit `Wohnungskrise` bleibt „Die Wohnungskrise verschärft sich“ sichtbar. „Wohnungskrise
  und Klimakrise“ wird über „Klimakrise“ trotzdem ausgeblendet.
- **Unscharfer Abgleich**: fängt OCR-Lesefehler ab. Bei Wörtern ab 8 Zeichen mit gleichem Anfangsbuchstaben reicht eine
  Abweichung von einem Buchstaben (Levenshtein-Distanz 1). Standardmäßig aus.
- **Vorschlagslisten**: fertige Listen zu vorwiegend negativen Themen, einzeln an- und
  abwählbar. Standardmäßig sind alle aktiv:
  Künstliche Intelligenz · Klimawandel · Krieg und Militär · Terror und Gewalt ·
  Verbrechen · Missbrauch und sexuelle Gewalt · Unglücke und Katastrophen ·
  Tod, Trauer, Suizid · Psychische Belastung · Drogen und Sucht · Hass und Diskriminierung ·
  Tierleid · Pandemie und Krankheit · Wirtschaftskrise · Krisen und Skandale allgemein.
  Die Kategorien lehnen sich an die Themenbereiche der NEON-Typologie für Inhaltswarnungen
  an, einer systematischen Übersichtsarbeit über Content- und Trigger-Warnungen
  ([Charles et al., PLOS ONE 2022](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0266722)).
  Dazu kommen die Themen, die laut [Reuters Institute Digital News Report](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2023/dnr-executive-summary)
  am häufigsten zum Meiden von Nachrichten führen (Krieg, Klima, Krisen).
  Wer schon Version 1.0.0 benutzt hat, findet die fünf neuen Kategorien (Missbrauch,
  Psychische Belastung, Sucht, Hass, Tierleid) zunächst abgehakt.
  Mit „Begriffe anzeigen“ sieht man den Inhalt. „In eigene Liste kopieren“ übernimmt die
  Begriffe zum Anpassen; die Vorschlagsliste dann abhaken. Die Listen stehen in
  `extension/lib/presets.js`. Begriffe mit vielen Fehltreffern sind bewusst weggelassen,
  etwa `Klima*` (Klimaanlage, Klimaticket), `Krebs` (Sternzeichen) oder `Bombe*`
  (Bombenstimmung).
- **Seiten**: „Auf allen Seiten filtern, außer …“ oder „Nur auf diesen Seiten filtern …“,
  dazu eine Domain pro Zeile.
- **Gesperrte Bereiche**: ganze Rubriken einer Seite immer unscharf stellen, wie bei
  Adblock, aber für Inhalte:
  1. Rechtsklick auf einen Beitrag → **„Diesen Bereich auf dieser Seite immer sperren …“**.
  2. Die Erweiterung markiert die Rubrik um den Beitrag (blau gestrichelt).
  3. Mit **Größer** und **Kleiner** anpassen, dann **Sperren** (Esc bricht ab).

  Gespeichert wird je Domain ein CSS-Selektor: die id des Bereichs oder Tag und Klassen.
  Teilen sich mehrere Rubriken dieselben Klassen, wird zusätzlich die Überschrift der Rubrik
  gespeichert, z. B. „Sport“. Neu geladene Inhalte werden mit erfasst. Ein Klick auf einen
  gesperrten Bereich bietet „Nur anzeigen“ und „Nicht mehr sperren“. Alle Regeln stehen
  in den Einstellungen unter „Seiten“ und lassen sich dort löschen.
- **Darstellung bei Treffer**:
  - **unscharf** (Standard): Text und Bilder des Blocks werden unscharf, ohne Hinweis auf
    das Schlagwort und ohne Knöpfe.
    1. Auf den unscharfen Text oder das Bild drücken: In der Mitte des Bildes bzw. Textes
       (bei langen Artikeln in der Mitte des sichtbaren Teils) erscheint sofort ein Ladekreis.
    2. Gedrückt halten, bis er voll ist (2 Sekunden): Der Inhalt wird angezeigt. Loslassen,
       Wegziehen oder Scrollen bricht ab.
    3. Danach fragt eine kleine Leiste „Künftig anzeigen?“: **👍** (so etwas künftig
       zeigen), **👎** (künftig ausblenden, sofort wieder unscharf), **ⓘ** (warum war das
       unscharf?) oder **×** (nur dieses Mal, nichts lernen).
  - Platzhalter „Ausgeblendet“ mit Knöpfen zum Bewerten
  - komplett ausblenden
- **Aufdecken nur durch Gedrückthalten** (Standard: an): Unscharfe Inhalte (und in der
  Platzhalter-Darstellung die Knöpfe „Anzeigen“/„Will ich sehen“) reagieren erst nach
  2 Sekunden Gedrückthalten. Ein kurzer Klick zeigt nur einen Hinweis. Das schützt vor dem
  reflexhaften Klick. Ausgeschaltet genügt ein Klick. Abschaltbar unter „Darstellung bei
  Treffer“; beim Update auf 1.3.1 wird die Option einmalig eingeschaltet.

  Das gefundene Schlagwort wird in keiner Darstellung angezeigt.
- **Bilder**: OCR ein/aus, Mindestbildgröße (Standard 120 × 80 px) und das Verhalten,
  wenn ein Bild nicht gelesen werden kann (Fehler oder Zeitüberschreitung nach 10 s).
  Standard ist „scharf stellen“, alternativ „unscharf lassen“ oder „ausblenden“.
- **Lernfilter**: siehe unten.
- **Cache leeren**: löscht die gespeicherten OCR-Ergebnisse.
- **Exportieren/Importieren**: speichert alle Einstellungen als JSON-Datei bzw. lädt sie.

### Rechtsklickmenü

Rechtsklick auf einen Artikel, ein Bild oder markierten Text → Untermenü **Ruhepol**:

| Eintrag | Wirkung |
|---|---|
| 👎 Künftig ausblenden | stellt den Artikel unscharf, merkt es sich und schlägt Begriffe als Schlagwörter vor |
| 👍 Künftig anzeigen | zeigt einen unscharfen Artikel an und merkt sich, dass so etwas passt |
| Warum unscharf? | erklärt den Grund: welches Schlagwort aus welcher Liste, KI, gelernt, Bereich – oder dass ein Bild noch geprüft wird |
| „…“ als Schlagwort ausblenden | nur bei markiertem Text: Begriff kommt auf die eigene Schlagwortliste |
| „…“ nie ausblenden | nur bei markiertem Text: Begriff kommt auf „Nie ausblenden“ (für Fehltreffer) |
| Ganzen Bereich auf dieser Seite sperren … | Auswahl wie bei Adblock, siehe „Gesperrte Bereiche“ |
| Auf dieser Seite ein/aus | schaltet Ruhepol für die Domain um |
| Einstellungen … | öffnet die Einstellungen |

### Lernfilter: bewerten und lernen lassen

Schlagwörter allein unterscheiden nicht, ob „Krise“ eine Klimakrise oder eine
Wohnungskrise ist. Deshalb lernt die Erweiterung aus deinen Bewertungen.

**Bewerten:**
- **Nach dem Anzeigen eines unscharfen Blocks:** 👍 oder 👎, wie oben beschrieben.
- **Rechtsklick auf einen Artikel oder ein Bild** (in jeder Darstellung, auch auf
  unscharfe Blöcke):
  - **„Will ich nicht sehen – unscharf stellen und merken“** stellt auch Inhalte ohne
    Schlagwort sofort unscharf. Danach schlägt eine Leiste die markanten Begriffe des
    Artikels als Schlagwörter vor: Hauptwörter, bei Bildern auch aus alt-Text und OCR-Text,
    bevorzugt Wörter, die der Lernfilter schon mit „ausblenden“ verbindet. Anklicken und
    **Hinzufügen** übernimmt sie in die eigene Liste.
  - **„Will ich sehen – nicht mehr ausblenden“**.
- **Text markieren → Rechtsklick → „„…“ zu den Schlagwörtern hinzufügen“** nimmt genau
  diesen Begriff in die eigene Liste auf (anpassen, z. B. mit `*`, in den Einstellungen).
- **Nur in der Darstellung „Platzhalter“:** zusätzlich die Knöpfe **Passt so**,
  **Will ich sehen** und **Anzeigen**, nach dem Anzeigen die Rückfrage „War das Ausblenden
  richtig?“.

**Was passiert:**
- Gelernt wird der Text des Blocks, also Überschrift, Vorspann, alt-Texte und der per OCR
  gelesene Bildtext. Ein kleiner Naive-Bayes-Klassifikator, wie bei Spamfiltern, merkt sich,
  welche Wörter und Wortpaare bei dir für „weg“ oder „passt“ sprechen.
- **Startbedingung:** Ab 10 Bewertungen, davon mindestens 3 je Richtung, entscheidet das
  Modell mit:
  - **Schlagwort trifft, aber das Modell ist sich sehr sicher, dass du es sehen willst**
    (über 95 %, mindestens 4 bekannte Wörter): Der Inhalt bleibt sichtbar.
  - **Kein Schlagwort, aber das Modell ist sich sehr sicher, dass du es nicht willst:** Der
    Inhalt wird ausgeblendet. Die Schwelle ist einstellbar (90/95/98 %, empfohlen 95 %) und
    auch abschaltbar.
- **Wie es rechnet:** Gewichtet werden nur Wörter, die mindestens zweimal vorkamen; geglättet
  wird Richtung ihrer Gesamthäufigkeit, und kein einzelnes Wort entscheidet allein. Wie oft
  du „weg“ oder „passt“ wählst, zählt nicht – man bewertet vor allem, was falsch lief.

  Bis 1.15 war das anders und wurde mit vielen Bewertungen schlechter. In einer Simulation
  (verschiedene Nutzerprofile bewerten 10, 30 oder 100 echte Teaser, geprüft an unabhängigen
  echten Teasern) blendete der alte Lernfilter nach 100 Bewertungen bis zu 72 harmlose
  Meldungen aus, oder er ließ belastende durch (36 statt 52 von 56 erkannt). Jetzt: 47 von
  56 bei 13 Fehltreffern (ohne Bewertungen 52 · 18). Ein zusätzlich getesteter „persönlicher
  Klassifikator“ auf den KI-Vektoren war in derselben Simulation nicht besser und ist daher
  nicht eingebaut.
- **Übersicht in den Einstellungen:** Status, die stärksten Wörter je Richtung, die letzten
  Bewertungen (einzeln löschbar) und „Gelerntes zurücksetzen“.

**Gemessen und nicht eingebaut** (gleiche Simulation, jeweils gegen den Lernfilter wie oben):

- *Gezielt nachfragen* bei Grenzfällen (wo die KI am unsichersten ist): Diese Bewertungen
  lehren nicht mehr als die, die ohnehin anfallen, teils weniger („nur Gewalt“: 8 statt 4,5
  Fehler). Ein Wochenrückblick mit zufälligen Beispielen brächte wenig (22 → 19 Fehler),
  verschlechterte das Profil „sensibel“ und müsste besuchte Texte speichern.
- *Schlagwort-Vorschläge* aus häufigen Wörtern in 👎-Bewertungen: Vorgeschlagen werden vor
  allem Orts- und Parteinamen. Übernommen blenden sie alles dazu aus, bis zu dreimal so
  viele Fehltreffer.
- *Altern alter Bewertungen*: Mit den vorhandenen Daten (eine Momentaufnahme) nicht messbar.
  Es würde den gemessenen Nutzen schwächen. Bewertungen lassen sich einzeln löschen, und
  gespeichert werden höchstens die letzten 3000.

**Grenzen:** Das Modell lernt Wörter, keine Bedeutung. „Flut“ und „Hochwasser“ sind für es
verschiedene Dinge, bis beide bewertet wurden. Bilder ohne Schrift beurteilt es nur über
den Text drumherum.

### Bedeutung verstehen (Stufe 2, KI lokal)

Optional, standardmäßig aus (Einstellungen → „Bedeutung verstehen“). Ein kleines
mehrsprachiges Sprachmodell (`multilingual-e5-small`) rechnet Überschrift und Vorspann
jedes Teasers in einen Vektor mit 384 Zahlen um. Texte mit ähnlicher Bedeutung liegen nah
beieinander, auch ohne gemeinsame Wörter und auch auf Englisch.

Ein Teaser wird unscharf, wenn er deutlich näher liegt an
- deinen Bewertungen „ausblenden“ (Mittel der 3 nächsten) oder
- den Themen-Beschreibungen und je zwei Beispiel-Schlagzeilen der aktivierten
  Vorschlagslisten und deinen eigenen Schlagwörtern

als an
- deinen Bewertungen „will ich sehen“ oder
- neutralen Vergleichstexten (Kultur, Fußball, Wintersport, Natur und Tiere, Geschichte,
  Politik, Studien, Weltraum, Bildnachweise …).

Texte mit weniger als vier Wörtern (Rubriknamen, Bildnachweise wie „Reuters/…“) prüft das
Modell nicht, weil es sie zufällig in die Nähe von allem rückt.

Die Empfindlichkeit ist einstellbar (vorsichtig / mittel / stark).

**Ablauf:**
- Geprüft wird nur, was Schlagwörter und Lernfilter durchgelassen haben, gesammelt in
  Paketen von bis zu 24 Teasern.
- Das Modell läuft in einem eigenen Worker-Thread des Offscreen Documents (transformers.js
  mit onnxruntime-web, WebAssembly), damit es die Bildvorbereitung für die Texterkennung
  nicht aufhält. Es lädt ausschließlich aus dem Paket, Downloads aus dem Internet sind
  abgeschaltet.
- Das Laden dauert beim ersten Mal ca. 5 s. Ruhepol beginnt damit schon beim Start von
  Chrome (und beim Einschalten des Bedeutungs-Filters), sonst beim ersten Seitenaufbau. So
  wird auch eine Nachrichten-Startseite gleich nach dem Start schneller beurteilt.
  Nach 15 Minuten ohne Arbeit wird das Modell entladen (ca. 250 MB Arbeitsspeicher frei).
- Berechnete Vektoren (Bezugstexte und Schlagzeilen) werden dauerhaft lokal gespeichert
  (höchstens 6000, ca. 2 KB je Text). Eine schon besuchte Nachrichtenseite wird dadurch
  sofort beurteilt, auch nachdem Chrome den Hintergrund-Prozess zwischendurch beendet hat.
- Geprüft wird parallel zum Textscan, nicht erst danach – auf Seiten mit Tickern wird der
  Textscan sonst nie fertig.
- Vektoren der Bewertungen werden lokal gespeichert (int8, ca. 0,5 KB je Bewertung) und
  nicht synchronisiert; jeder Rechner berechnet sie aus den synchronisierten Bewertungen.

**Speicher:** ca. 135 MB Modell + 27 MB Laufzeit auf der Festplatte, beim Rechnen ca.
200–300 MB Arbeitsspeicher.

**Wie entschieden wird:** Der Teaser-Text wird zuerst bereinigt (Postingzähler, Uhrzeiten,
Videolängen, Bildnachweise). Dann zählt das Mittel aus zwei Vergleichen:
1. Nähe zu den Themenbeschreibungen (und deinen Bewertungen, Schlagwörtern, Wünschen) minus
   Nähe zu neutralen Vergleichstexten,
2. Nähe zu den 3 ähnlichsten belastenden Beispielen der aktivierten Themen minus Nähe zu den
   3 ähnlichsten harmlosen. Die Beispiele: rund 160 belastende und 125 harmlose, selbst
   formuliert (`extension/lib/examples.js`), dazu 96 belastende und 357 harmlose **echte
   Teaser** von orf.at und derStandard, von Hand eingestuft. Von den echten Teasern sind nur
   die berechneten Vektoren in der Erweiterung (`extension/lib/real-vectors.json`, keine
   Texte); jeder belastende hat ein oder mehrere Themen und zählt nur, wenn eines davon
   gesperrt ist. Neu erzeugen mit `npm run beispielvektoren`.

**Gemessen** an echten Teasern von orf.at und derStandard vom 3. Oktober 2026, von Hand
eingestuft (`npm run kalibrieren`; die Teaser selbst sind als fremde Texte nicht im Repo,
nur lokal unter `test/fixtures/real-headlines.json`). Datensatz A
(453 Teaser) diente zum Abstimmen; Datensatz B (391 Teaser von anderen Seiten: orf.at
Bundesländer, FM4, Help, derStandard Inland/Panorama/Kultur/Etat/Lifestyle/Web/Gesundheit)
wurde erst danach gesammelt und nur zur Prüfung verwendet. Zahlen: belastende erkannt ·
harmlose fälschlich unscharf, Schlagwörter und Bedeutungs-Filter zusammen:

| | vorsichtig | mittel | stark |
|---|---|---|---|
| A vorher | 81/96 · 12 | 88/96 · 25 | 92/96 · 47 |
| A jetzt | 83/96 · 12 | 85/96 · 18 | 88/96 · 28 |
| B vorher | 46/56 · 22 | 51/56 · 26 | 52/56 · 38 |
| B mit eigenen Beispielen | 51/56 · 24 | 52/56 · 29 | 53/56 · 33 |
| **B mit echten Beispielen (jetzt)** | **52/56 · 14** | **52/56 · 19** | **52/56 · 21** |

Die letzte Zeile ist die ehrlichste Messung: B war beim Abstimmen nie im Spiel. Die Schwellen
mit echten Beispielen wurden auf A so bestimmt, dass jeder Teaser sich selbst nicht als
Beispiel sehen durfte (A dann: 90/96 · 12, 92/96 · 16, 93/96 · 21). In den B-Zahlen der letzten
Zeile stecken die eingebauten Ausnahmen der Schlagwortlisten (siehe unten). Von den 19
Fehltreffern auf Stufe mittel kommen 12 von den Schlagwortlisten selbst, nur 7 vom
Bedeutungs-Filter.

Echte Beispiele schlagen selbst formulierte: In einem Vorversuch brachten sie auf B bei
gleicher Fehltrefferzahl 2–3 Treffer mehr; noch mehr Beispiele (eigene + echte) brachten
darüber hinaus nichts. Laufend aktualisierte Datenbanken (etwa GDELT) würden daher wenig
bringen – deine eigenen 👍/👎-Bewertungen wirken genauso, nur auf dich zugeschnitten. Zusammen mit den Schlagwörtern ist der Gewinn
kleiner: Das kleine Sprachmodell kann Teaser wie „Wie Unternehmen 2027 Gehälter erhöhen“
und „Brücke in Kyjiw von Drohne getroffen“ nur begrenzt auseinanderhalten. Ein größeres
Modell (multilingual-e5-base, 280 MB) war in derselben Messung schlechter, nicht besser.

Ein Teil der Fehltreffer auf B kam von den Schlagwortlisten selbst („Die Toten Hosen“ →
„Toten“, „Rosenkrieg“, „Katastrophenübung“); dafür gibt es jetzt eingebaute Ausnahmen. Weil
diese erst nach Sichtung von B ergänzt wurden, ist dieser Teil der Verbesserung auf B nicht
unabhängig gemessen.

Die Kette selbst ist zusätzlich mit einem winzigen Testmodell automatisch getestet
(`test/make_tiny_model.py`, `test/semantik.mjs`).

### KI-Gegenprüfung von Schlagwort-Treffern

Ist der Bedeutungs-Filter an, prüft das Modell Schlagwort-Treffer zusätzlich gegen
(abschaltbar unter Erkennung → „Schlagwort-Treffer gegenprüfen“). Liegt der Text klar näher
an neutralen Themen (Sport, Kultur, Alltag …) als an den gesperrten Themen und deinen
„ausblenden“-Bewertungen, wird er wieder scharf.

Gemessen:
- **wieder gezeigt:** „Trotz Iran-Krieges: Saisonfinale soll in Abu Dhabi steigen“,
  „ÖFB-Team will Vorsprung im Kosovo ausbauen“
- **unscharf geblieben:** „Drohnen treffen Kraftwerk, Millionen ohne Strom“, „Flut in
  Kärnten“, „Schüsse vor Synagoge“, „Künstlerin Ingrid Wiener verstorben“

Die Schwelle ist bewusst streng: Lieber bleibt eine doppeldeutige Sportmeldung unscharf, als
dass eine echte Meldung aufgedeckt wird.

Bis zur Prüfung bleibt der Treffer unscharf. Die eigenen Schlagwörter zählen dabei bewusst
nicht als Themen-Anker, sonst wäre ein Treffer auf „Museum“ immer „nah an Museum“.

### Wünsche in eigenen Worten

Unter Themen → „In eigenen Worten“ stehen zwei Felder für ganze Sätze, einer pro Zeile:
- **Will ich nicht sehen**, z. B. „Streit in der Innenpolitik und im Wahlkampf“
- **Will ich trotzdem sehen**, z. B. „Sportberichte, auch wenn ein Krieg erwähnt wird“

Jeder Satz wird für den Bedeutungs-Filter zu einem zusätzlichen Vergleichspunkt. Ähnelt
eine Meldung einem „nicht sehen“-Satz, wird sie unscharf, auch ohne Schlagwort. Ähnelt sie
einem „trotzdem sehen“-Satz, bleibt sie sichtbar bzw. wird nach einem Schlagwort-Treffer
wieder aufgedeckt. Eigene Wünsche gehen den eingebauten neutralen Vergleichstexten vor.
Wirkt nur mit eingeschaltetem Bedeutungs-Filter; Regeln wie „nur auf orf.at“ versteht er
nicht, nur Themen. Die Sätze werden wie alle Einstellungen synchronisiert.

Gemessen mit dem echten Modell: Mit dem Wunsch „Streit in der Innenpolitik und im
Wahlkampf“ werden „Koalition zerstreitet sich über das Budget“ und „Parteien liefern sich
heftigen Schlagabtausch im Wahlkampf“ unscharf. „Neue Straßenbahnlinie“, das Derby und
Sportmeldungen bleiben sichtbar, „Russische Truppen rücken vor“ bleibt trotz des
Sport-Wunsches unscharf.

### Chromes eingebautes Modell (Gemini Nano, optional)

Neuere Chrome-Versionen bringen ein eigenes kleines Sprachmodell mit, das lokal läuft. Wo es
vorhanden ist, nutzt Ruhepol es für zwei Dinge; wo nicht, funktioniert alles andere wie bisher.

**Assistent** (Themen → Assistent): Du schreibst, was du ändern willst, etwa „Fußball soll nie
unscharf sein, außer bei Gewalt im Stadion“. Das Modell schlägt Änderungen vor (Schlagwörter,
Nie-Liste, Themenlisten, Wünsche in eigenen Worten, Seiten ein/aus, Empfindlichkeit). Du
siehst sie als Liste und übernimmst oder verwirfst sie. Ungültige Vorschläge (unbekannte
Listen, nicht vorhandene Wörter) werden vorher aussortiert.

**Zweite Meinung bei Grenzfällen** (Erkennung → „Grenzfälle zusätzlich … prüfen“, an):
Schlagwort-Treffer, die die KI-Gegenprüfung nur knapp nicht als harmlos einstuft, beurteilt
Gemini Nano noch einmal: aktuelle belastende Meldung oder nur nebenbei (Sport, Rückblick,
Kultur)? Nur bei „harmlos“ wird der Treffer scharf, im Zweifel bleibt er unscharf. Das
betrifft wenige Meldungen je Seite und läuft in einer eigenen Warteschlange, damit der
schnelle Bedeutungs-Filter nicht wartet. Braucht den Bedeutungs-Filter.

**Voraussetzungen** (laut Chrome): Chrome 138 oder neuer, Windows 10/11, macOS 13+, Linux
oder Chromebook Plus; mindestens 22 GB frei auf dem Laufwerk des Chrome-Profils; eine
Grafikkarte mit mehr als 4 GB Speicher oder 16 GB Arbeitsspeicher und 4 Kerne. Das Modell
(einige GB) lädt Chrome selbst herunter; der Knopf „Chrome-Modell herunterladen“ stößt das
an. Nicht auf Android/iOS. Die Einstellungsseite zeigt an, ob es bereitsteht.

**Grenzen:** Gemini Nano ist für Englisch optimiert; Ruhepol fragt Deutsch an und weicht auf
Englisch aus, wenn Chrome Deutsch nicht anbietet – die Antworten können dann ungenauer sein.
Antworten eines Sprachmodells sind nicht bei jedem Durchlauf exakt gleich. Getestet ist die
Anbindung automatisch mit einem Ersatzmodell (`test/nano.mjs`); mit dem echten Gemini Nano
konnte ich mangels passender Hardware nicht testen.

Warum nicht Gemini Nano statt des mitgelieferten Modells? Chrome bietet keine Funktion, um
Texte in Vergleichsvektoren umzurechnen – Lernfilter, Gegenprüfung und „gute Nachrichten“
beruhen aber darauf. Außerdem bräuchte Nano für jede Meldung eine eigene Antwort; bei 85
Überschriften auf orf.at wäre das viel langsamer als das mitgelieferte Modell, das alle in
Paketen vergleicht.

### Bewusst geöffnete Artikel vollständig lesen

Öffnest du einen Artikel über einen Teaser, der **nicht** unscharf war (oder den du selbst
aufgedeckt hast), bleibt der Artikel lesbar, auch wenn darin Wörter wie „Krieg“ oder
„Schüsse“ vorkommen (Einstellungen → Darstellung, standardmäßig an).

- Ruhepol merkt sich beim Klick die Zieladresse (30 Minuten) und den Tab (20 Sekunden, für
  Umleitungen und neue Tabs). Mittelklick, Strg-/Cmd-Klick und „Link in neuem Tab öffnen“
  zählen auch, ebenso Teaser-Karten, bei denen die Überschrift nicht im Link steht
  (derStandard). Gespeichert nur bis zum Schließen des Browsers.
- Frei bleibt nur der Artikel selbst: der Bereich um die Hauptüberschrift (`article`/`main`).
  Teaser-Leisten („Mehr zum Thema“, „Meistgelesen“), Navigation und Seitenleisten werden
  weiter gefiltert.
- Was du selbst gesperrt hast (👎, „Künftig ausblenden“, Bereiche), bleibt auch im Artikel
  unscharf. Frei werden nur automatische Treffer (Schlagwörter, Bildtext, KI, Lernfilter).
- Direkt geöffnete Artikel (Lesezeichen, Suche, geteilte Links) werden normal gefiltert – den
  Teaser hast du dann ja nicht gesehen.

Geprüft auf derStandard: Im Artikel „Ein Stück Beton in Prishtina“ waren beim direkten
Öffnen vier Absätze zum Kosovo-Krieg unscharf; über den sichtbaren Teaser geöffnet ist er
vollständig lesbar.

### Artikelseiten: nur der betroffene Absatz

Steht ein Treffer in einem Absatz eines längeren Fließtexts (mindestens drei Absätze
nebeneinander), wird nur dieser Absatz unscharf, nicht der ganze Textbereich samt Fotos.

**Milde Listen im Fließtext:** Wörter aus „Wirtschaftskrise“ und „Krise & Skandal“
(„Massenentlassungen“, „Skandal“, „Inflation“ …) stehen in Artikeln oft nur nebenbei, etwa
in einem historischen Rückblick. In einem langen Artikel-Absatz (über 200 Zeichen) genügt
deshalb ein einzelnes solches Wort nicht. Unscharf wird der Absatz erst, wenn
- ein zweites Wort aus diesen Listen dazukommt, oder
- ein Wort aus einer anderen Liste oder ein eigenes Schlagwort darin steht, oder
- das Sprachmodell (falls eingeschaltet) den Absatz als belastend einstuft.

Schlagzeilen, Teaser und kurze Texte bleiben so streng wie bisher.

### Gute Nachrichten trotzdem zeigen

Optional (Einstellungen → Erkennung), braucht das Sprachmodell. Auch bei gesperrten Themen
werden eindeutig positive Meldungen angezeigt, z. B. „Waffenstillstand hält“, „Impfstoff
gegen Malaria“, „Arbeitslosigkeit sinkt“ oder „KI hilft Ärzten“.

**Ablauf:**
1. Ein Treffer wird wie immer sofort unscharf; Negatives blitzt nie auf.
2. Danach vergleicht das Modell den Text mit Gut/Schlecht-Beschreibungen je Thema, z. B.
   „Klimaschutz wirkt, Emissionen sinken“ gegen „Klimakrise verschärft sich“. Weil beide
   Seiten dasselbe Thema beschreiben, hebt sich das Thema heraus und der Ton bleibt übrig.
3. Klar positive Meldungen werden wieder scharf.

**Nie aufgedeckt werden:**
- Meldungen zu Tod/Suizid und Missbrauch, auch wenn sie positiv sind (dort belastet oft
  schon die Erwähnung)
- selbst gesperrte Inhalte (👎) und gesperrte Bereiche
- Inhalte, die der Lernfilter klar als unerwünscht kennt

Gemessen mit 32 Schlagzeilen: mittel 8 von 12 guten gezeigt, 0 von 20 schlechten;
vorsichtig 6/12, stark 9/12, jeweils ohne Fehlanzeige.

### Synchronisieren zwischen Rechnern

- **Einstellungen** liegen in `chrome.storage.sync`.
- **Bewertungen:** Die neuesten (Text auf 280 Zeichen gekürzt, je nach Länge einige hundert)
  werden zusätzlich dort gespiegelt. Gelernt wird auf jedem Rechner lokal aus den
  zusammengeführten Bewertungen. Gelöschte Bewertungen und „Zurücksetzen“ werden mit
  abgeglichen.
- **Voraussetzungen:**
  - Auf jedem Rechner (Windows, Mac, Linux) ist die Erweiterung aus diesem Ordner geladen,
    dank fester Kennung überall dieselbe.
  - Chrome ist mit demselben Google-Konto angemeldet.
  - Die Synchronisierung ist eingeschaltet (`chrome://settings/syncSetup` →
    „Synchronisierung verwalten“ → **Erweiterungen** an).
- **Andere Browser:** Bei Edge, Brave und anderen Chromium-Browsern läuft der Abgleich über
  deren eigenes Konto. Der Austausch zwischen verschiedenen Browsern geht nur per
  Export/Import.

**iPhone/iPad:** Chrome auf iOS unterstützt keine Erweiterungen. Möglich wäre nur eine
Safari-Erweiterung. Die muss mit Xcode auf einem Mac als App gebaut werden, und Safari kennt
kein Offscreen Document, die OCR müsste also umgebaut werden. Einstellungen und Bewertungen
lassen sich dort nicht über Chrome synchronisieren, sondern nur per Export/Import (oder
später über iCloud).

## So funktioniert es

**Text**: Textknoten der Seite sowie `alt`, `title`, `aria-label` und `figcaption` werden
geprüft. Bei einem Treffer wird der umgebende Inhaltsblock ausgeblendet:
1. das nächste `article`, `li` oder `figure`;
2. sonst ein Teaser-Container, also der größte Vorfahre mit nur einer Überschrift und
   wenigen Links (so sind z. B. die `div`-Meldungen auf orf.at aufgebaut);
3. sonst `section` oder `a`.

Nie ausgeblendet werden `body`, `main`, Elemente mit `role="main"`/`role="feed"`, Blöcke
mit vier oder mehr Beiträgen und Blöcke etwa so groß wie das Fenster. Ein
`MutationObserver` erfasst nachgeladene Inhalte. Die Arbeit wird gebündelt und in kleinen
Häppchen per `requestIdleCallback` erledigt, damit die Seite nicht ruckelt.

**Bilder**:
1. Jedes neue Bild wird beim Einfügen per CSS unscharf gestellt. Das gilt auch bei
   Lazy Loading: Änderungen an `src`/`srcset` und `load`-Ereignisse werden beobachtet,
   verwendet wird `currentSrc`.
2. **Vorauswahl**: Zuerst werden alt-Text, Titel und Bildunterschrift geprüft, noch bevor
   das Bild geladen ist. Steht das Schlagwort schon dort oder im Teaser-Text daneben, wird
   der Block sofort ausgeblendet und das Bild gar nicht erst per OCR gelesen.
   Schlagwortlisten von Agenturfotos („Geld, Münzen, Eurokrise, Finanzkrise, …“, ab sechs
   kurzen Einträgen) zählen nicht: Sie beschreiben das Symbolbild, nicht die Meldung.
3. Bilder unter der Mindestgröße (Symbole, Logos) werden sofort wieder scharf.
4. Sonst lädt der Service Worker das Bild per `fetch`. Dank `host_permissions` gibt es
   dabei keine CORS-Probleme mit fremden Bild-Domains. Das Bild geht an ein Offscreen
   Document, weil Service Worker keine Web Worker starten können. Dort wird es skaliert
   (lange Seite höchstens 1200 px, nur Bilder unter 500 px werden bis 2-fach vergrößert),
   als unkomprimiertes BMP an tesseract.js übergeben und gelesen (Deutsch + Englisch).
   Das BMP ist wichtig für das Tempo: Übergibt man tesseract.js ein Canvas, wandelt es dieses
   per `canvas.toBlob()` um – das dauert im Offscreen Document jedes Mal genau 1 Sekunde,
   während die eigentliche Texterkennung nur 30–300 ms braucht.
5. Die Worker (je zweiter Prozessorkern einer, 2 bis 4) werden einmal erzeugt und
   wiederverwendet. Herunterladen läuft parallel zur Texterkennung. Geprüft wird
   vorausschauend, sobald ein Bild bis auf 1200 px an den sichtbaren Bereich herankommt.
   Gemessen auf orf.at beim Durchscrollen (erster Besuch): Bilder bleiben nach dem
   Sichtbarwerden im Median 1,1 s unscharf (vorher 7 s), höchstens 2 s (vorher 15 s);
   beim zweiten Besuch meist gar nicht (Cache).
6. Übernommen werden nur Wörter, bei denen Tesseract ziemlich sicher ist (Sicherheit ≥ 70,
   überwiegend Buchstaben). Fotos ohne Schrift – Rasen, Laub, Stoff – liefern sonst
   Buchstabensalat, der die Schlagwort- und KI-Prüfung in die Irre führt.
   Lazy-Loading-Platzhalter (1×1-GIFs) werden nicht gelesen.
7. Der erkannte Text wird pro Bild-URL in `chrome.storage.local` gecacht (höchstens 2000
   Einträge, die ältesten werden zuerst gelöscht). Weil der Text gespeichert wird und nicht
   nur „Treffer ja/nein“, braucht eine geänderte Schlagwortliste keinen neuen OCR-Lauf.
8. Bei einem Treffer wird der Block ausgeblendet, sonst wird das Bild wieder scharf. Ein Bild,
   das noch geprüft wird, lässt sich per Gedrückthalten sofort aufdecken.
9. **CSS-Hintergrundbilder** (`background-image`) und **Video-Vorschaubilder**
   (`<video poster>`) werden genauso per OCR geprüft und währenddessen unscharf gestellt.
   Erfasst werden Elemente wie `div`, `a`, `span`, `figure`, `li`, `article`, `section`.
   Die Prüfung läuft in einer eigenen Warteschlange nur in echter Leerlaufzeit, weil das
   Auslesen der Stile sonst das Laden bremsen würde. Seitenhintergründe in Fenstergröße
   werden ausgelassen.
10. **Shadow-DOM**: Offene Shadow-Roots (Web-Komponenten) werden gefunden, beobachtet und
   mit eigenen Regeln versehen, sodass Text, Bilder und Nachgeladenes darin genauso
   gefiltert werden.

## Grenzen

- **Rechenzeit**: OCR braucht je nach Bild und Rechner etwa 0,3–2 s pro Bild. Auf
  bildlastigen Seiten bleiben Bilder deshalb kurz unscharf. Bereits gelesene Bilder kommen
  aus dem Cache.
- **Speicher**: Die beiden OCR-Worker belegen zusammen grob 100–200 MB, solange sie
  arbeiten. Nach 5 Minuten ohne Arbeit werden sie beendet.
- **Nicht erfasst**: `<canvas>`, laufende Videos (nur das Vorschaubild), in `<svg>`
  gezeichnete Schrift, geschlossene Shadow-Roots sowie Hintergrundbilder auf
  Pseudo-Elementen (`::before`/`::after`).
- **Hintergrundbilder kurz sichtbar**: Anders als `<img>` werden CSS-Hintergrundbilder
  erst im Leerlauf erkannt und können daher kurz scharf zu sehen sein, bevor sie unscharf
  werden.
- **Gesperrte Bereiche**: Baut eine Seite ihr Layout um (neue Klassen oder ids), passt die
  Regel nicht mehr. Dann den Bereich einfach neu sperren.
- **OCR-Fehler**: Stark stilisierte, sehr kleine, gedrehte oder schräge Schrift wird oft
  nicht oder falsch erkannt. Der unscharfe Abgleich hilft bei einzelnen Buchstabenfehlern.
- **Fehltreffer**: Wortlisten sind nie perfekt. „Tote“ trifft auch „Die Toten Hosen“,
  „Drama“ auch Theaterkritiken. Einzelne Listen abwählen oder Begriffe in die eigene Liste
  kopieren und anpassen.
- **Bildquellen mit Schutz**: Manche Server liefern Bilder nur mit passendem `Referer`
  oder Cookies aus. Solche Bilder kann die Erweiterung nicht laden; dann greift die
  Einstellung für Fehler (Standard: scharf stellen).
- **Layout**: Die Erkennung des Inhaltsblocks ist eine Heuristik. Auf ungewöhnlich
  aufgebauten Seiten verschwindet manchmal zu wenig (nur die Überschrift) oder ein
  größerer Block.
- **Blitzer**: Die Einstellungen werden asynchron geladen. Sehr früh gezeichnete Bilder
  können deshalb für wenige Millisekunden scharf zu sehen sein.

## Entwicklung und Tests

```bash
npm install
npm run setup        # vendor/ und Sprachdaten
npm test             # Unit-Tests (Abgleich, Listen, Lernmodell, Bedeutungs-Logik) + Playwright-Tests
                     # (Testseite, Lernfilter, Hintergrundbilder/Shadow-DOM/Gedrückthalten/Bereiche,
                     #  Bedeutungs-Filter mit Testmodell, Wünsche und Chrome-Modell mit Ersatzmodell)
npm run test:orf     # Praxistest gegen https://orf.at (braucht Internet; HEADED=1 für sichtbares Fenster)
```

Der Playwright-Test startet zwei lokale Server: die Testseite auf `127.0.0.1` und die
Bilder auf `localhost` als fremde Domain. Geprüft werden:
- normaler Text-Teaser
- Bild mit Schlagwort im alt-Attribut
- Bild mit eingebrannter deutscher Schrift (selbst erzeugt mit `test/make-images.mjs`)
- Kontrollbild ohne Treffer
- kleines Symbol
- nachgeladener Text und nachgeladenes Lazy-Bild
- orf.at-artiger `div`-Aufbau
- alle drei Darstellungsarten
- Zähler im Popup
- Cache
- Fehlerfälle
- Vorschlagslisten
- Lasttest mit 4000 Listeneinträgen, bei dem die Erweiterung keine langen Tasks erzeugt

`npm run test:orf` gibt die ausgeblendeten Blöcke, den Bildstatus und lange Tasks aus und
legt Screenshots in `test-results/` ab.

### Aufbau

```
extension/
  manifest.json      MV3-Manifest
  background.js      Service Worker: Bild-fetch, OCR-Warteschlange, Cache, Zähler
  offscreen.html/js  tesseract.js-Worker (Offscreen Document, reason WORKERS)
  content.js/.css    Text- und Bildfilter auf der Seite
  popup.html/js      Popup
  options.html/js    Einstellungsseite
  lib/match.js       Abgleich (Normalisierung, Platzhalter, Levenshtein)
  lib/presets.js     Vorschlagslisten
  lib/onboarding.js  Kennenlernen: Beispiel-Schlagzeilen, Auswahl daraus ableiten
  kennenlernen.html/js  Kennenlernen-Seite (öffnet sich bei der Installation)
  lib/learn.js       Lernfilter (Naive Bayes)
  lib/semantic.js    Bedeutungs-Filter: Entscheidung, Schwellen, Vektor-Speicherung
  semantic.js        Sprachmodell im Offscreen Document (transformers.js)
  lib/nano.js        Chromes eingebautes Modell (Gemini Nano): Assistent, zweite Meinung
  lib/settings.js    Einstellungen und Seitenregeln
  vendor/            wird von „npm run setup“ erzeugt (nicht im Git)
scripts/             Build, Sprachdaten, Symbole
test/                Unit-Tests, Playwright-Test, Testseite, Testbilder
```

## Drittanbieter

- tesseract.js und tesseract.js-core: Apache-2.0
- Sprachdaten `tessdata_fast`: Apache-2.0
- transformers.js: Apache-2.0
- onnxruntime-web: MIT
- Sprachmodell `multilingual-e5-small` (intfloat, ONNX-Fassung von Xenova): MIT

Die Lizenztexte der Bibliotheken werden nach `extension/vendor/` kopiert.
