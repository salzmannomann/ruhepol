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
    1. Auf den unscharfen Text oder das Bild drücken: An der Druckstelle erscheint sofort ein
       Ladekreis.
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
  - **Schlagwort trifft, aber das Modell ist sich sicher, dass du es sehen willst:** Der
    Inhalt bleibt sichtbar.
  - **Kein Schlagwort, aber das Modell ist sich sehr sicher, dass du es nicht willst:** Der
    Inhalt wird ausgeblendet. Die Schwelle ist einstellbar (80/90/95 %) und auch
    abschaltbar.
- **Übersicht in den Einstellungen:** Status, die stärksten Wörter je Richtung, die letzten
  Bewertungen (einzeln löschbar) und „Gelerntes zurücksetzen“.

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
- Das Modell läuft im Offscreen Document (transformers.js mit onnxruntime-web,
  WebAssembly, ein Thread). Es lädt ausschließlich aus dem Paket, Downloads aus dem
  Internet sind abgeschaltet.
- Nach 5 Minuten ohne Arbeit wird das Modell entladen.
- Vektoren der Bewertungen werden lokal gespeichert (int8, ca. 0,5 KB je Bewertung) und
  nicht synchronisiert; jeder Rechner berechnet sie aus den synchronisierten Bewertungen.

**Speicher:** ca. 135 MB Modell + 27 MB Laufzeit auf der Festplatte, beim Rechnen ca.
200–300 MB Arbeitsspeicher.

**Stand:** Die ganze Kette ist mit einem winzigen Testmodell automatisch getestet
(`test/make_tiny_model.py`, `test/semantik.mjs`). Die Schwellen für das echte Modell sind
mit echten Schlagzeilen von sport.orf.at, wien.orf.at und science.orf.at kalibriert
(`npm run kalibrieren`, `extension/lib/semantic.js`):

| Stufe | belastende erkannt | Fehltreffer |
|---|---|---|
| vorsichtig | 16/20 | 0/22 |
| mittel | 16/20 | 0/22 |
| stark | 18/20 | 1/22 |

Auf den echten Startseiten wurden auf sport.orf.at vorher 5 harmlose Meldungen unscharf
(z. B. „Wildcard für Hirscher bei Comeback fix“), jetzt keine. Auf science.orf.at blieben
von 8 Fehltreffern („Schmetterlinge: Muster auf Flügeln verwirren Angreifer“,
„Vorschulkinder schaffen 18.000 Schritte“ …) keine übrig; erkannt werden weiterhin
„Hitzetote im Sommer“, „Niedrigste Abflussmengen“, „Vier Beschuldigte nach Hauseinsturz“.

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
   (lange Seite höchstens 1600 px, kleine Bilder bis 2-fach vergrößert) und von
   tesseract.js gelesen (Deutsch + Englisch).
5. Die Worker werden einmal erzeugt und wiederverwendet. Die Warteschlange arbeitet
   höchstens zwei Bilder parallel ab, Bilder außerhalb des sichtbaren Bereichs kommen erst
   beim Heranscrollen dran.
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
                     #  Bedeutungs-Filter mit Testmodell)
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
  lib/learn.js       Lernfilter (Naive Bayes)
  lib/semantic.js    Bedeutungs-Filter: Entscheidung, Schwellen, Vektor-Speicherung
  semantic.js        Sprachmodell im Offscreen Document (transformers.js)
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
