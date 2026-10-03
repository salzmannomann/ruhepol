# Schlagwortfilter

Chrome-Erweiterung (Manifest V3), die Inhalte mit bestimmten Schlagwörtern ausblendet –
auch wenn das Wort nur als Schrift **im Bild** steht. Die Texterkennung (OCR) läuft mit
[tesseract.js](https://github.com/naptha/tesseract.js) komplett lokal in der Erweiterung:
keine externen Server, keine CDNs, keine Datenübertragung.

## Installation

Voraussetzung zum Bauen: [Node.js](https://nodejs.org/) ab Version 18.

1. Abhängigkeiten holen und das Paket fertigstellen:

   ```bash
   npm install
   npm run setup
   ```

   `npm run setup` kopiert tesseract.js, den Worker und den WASM-Kern aus `node_modules`
   nach `extension/vendor/` und lädt die Sprachdaten Deutsch und Englisch
   (`tessdata_fast`, zusammen etwa 6 MB) nach `extension/vendor/lang/`.

2. In Chrome `chrome://extensions` öffnen.
3. Rechts oben den **Entwicklermodus** einschalten.
4. **Entpackte Erweiterung laden** anklicken und den Ordner **`extension`** in diesem
   Projekt auswählen (nicht den Projektordner selbst).
5. Optional: Das Puzzle-Symbol in der Symbolleiste anklicken und den Schlagwortfilter
   anheften.

Nach Änderungen am Code auf `chrome://extensions` beim Schlagwortfilter auf den
Neu-laden-Pfeil klicken und offene Tabs neu laden.

## Bedienung

### Popup (Klick auf das Symbol)

- **Filter aktiv**: schaltet die Erweiterung überall ein oder aus.
- **Auf dieser Seite**: schaltet den Filter nur für die aktuelle Domain ein oder aus
  (inklusive Subdomains).
- **Zähler**: Anzahl der ausgeblendeten Elemente auf der aktuellen Seite. Die Zahl steht
  auch als Plakette auf dem Symbol.
- **Einstellungen**: öffnet die Einstellungsseite.

### Einstellungen

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
- **Unscharfer Abgleich**: fängt OCR-Lesefehler ab. Bei Wörtern ab 6 Zeichen reicht eine
  Abweichung von einem Buchstaben (Levenshtein-Distanz 1). Standardmäßig aus.
- **Vorschlagslisten**: fertige Listen zu vorwiegend negativen Themen, einzeln an- und
  abwählbar. Standardmäßig sind alle aktiv:
  Künstliche Intelligenz · Klimawandel · Krieg und Militär · Terror und Gewalt ·
  Verbrechen · Unglücke und Katastrophen · Tod, Trauer, Suizid · Pandemie und Krankheit ·
  Wirtschaftskrise · Krisen und Skandale allgemein.
  Mit „Begriffe anzeigen“ sieht man den Inhalt. „In eigene Liste kopieren“ übernimmt die
  Begriffe zum Anpassen; die Vorschlagsliste dann abhaken. Die Listen stehen in
  `extension/lib/presets.js`. Begriffe mit vielen Fehltreffern sind bewusst weggelassen,
  etwa `Klima*` (Klimaanlage, Klimaticket), `Krebs` (Sternzeichen) oder `Bombe*`
  (Bombenstimmung).
- **Seiten**: „Auf allen Seiten filtern, außer …“ oder „Nur auf diesen Seiten filtern …“,
  dazu eine Domain pro Zeile.
- **Darstellung bei Treffer**:
  - Platzhalter „Ausgeblendet (Schlagwort) – klicken zum Anzeigen“ (Standard)
  - unscharf, Klick zeigt den Inhalt
  - komplett ausblenden
- **Bilder**: OCR ein/aus, Mindestbildgröße (Standard 120 × 80 px) und das Verhalten,
  wenn ein Bild nicht gelesen werden kann (Fehler oder Zeitüberschreitung nach 10 s).
  Standard ist „scharf stellen“, alternativ „unscharf lassen“ oder „ausblenden“.
- **Cache leeren**: löscht die gespeicherten OCR-Ergebnisse.
- **Exportieren/Importieren**: speichert alle Einstellungen als JSON-Datei bzw. lädt sie.

Die Einstellungen liegen in `chrome.storage.sync` und werden mit dem Google-Konto
synchronisiert, wenn die Chrome-Synchronisierung eingeschaltet ist.

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
3. Bilder unter der Mindestgröße (Symbole, Logos) werden sofort wieder scharf.
4. Sonst lädt der Service Worker das Bild per `fetch`. Dank `host_permissions` gibt es
   dabei keine CORS-Probleme mit fremden Bild-Domains. Das Bild geht an ein Offscreen
   Document, weil Service Worker keine Web Worker starten können. Dort wird es skaliert
   (lange Seite höchstens 1600 px, kleine Bilder bis 2-fach vergrößert) und von
   tesseract.js gelesen (Deutsch + Englisch).
5. Die Worker werden einmal erzeugt und wiederverwendet. Die Warteschlange arbeitet
   höchstens zwei Bilder parallel ab, Bilder außerhalb des sichtbaren Bereichs kommen erst
   beim Heranscrollen dran.
6. Der erkannte Text wird pro Bild-URL in `chrome.storage.local` gecacht (höchstens 2000
   Einträge, die ältesten werden zuerst gelöscht). Weil der Text gespeichert wird und nicht
   nur „Treffer ja/nein“, braucht eine geänderte Schlagwortliste keinen neuen OCR-Lauf.
7. Bei einem Treffer wird der Block ausgeblendet, sonst wird das Bild wieder scharf.

## Grenzen

- **Rechenzeit**: OCR braucht je nach Bild und Rechner etwa 0,3–2 s pro Bild. Auf
  bildlastigen Seiten bleiben Bilder deshalb kurz unscharf. Bereits gelesene Bilder kommen
  aus dem Cache.
- **Speicher**: Die beiden OCR-Worker belegen zusammen grob 100–200 MB, solange sie
  arbeiten. Nach 5 Minuten ohne Arbeit werden sie beendet.
- **Nicht erfasst**: CSS-Hintergrundbilder, `<canvas>`, Videos, Text in Shadow-DOM, in
  `<svg>` gezeichnete Schrift und Bilder in geschlossenen Shadow-Roots.
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
npm test             # Unit-Tests (Abgleich, Listen) + Playwright-Test mit lokaler Testseite
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
  lib/settings.js    Einstellungen und Seitenregeln
  vendor/            wird von „npm run setup“ erzeugt (nicht im Git)
scripts/             Build, Sprachdaten, Symbole
test/                Unit-Tests, Playwright-Test, Testseite, Testbilder
```

## Drittanbieter

tesseract.js und tesseract.js-core stehen unter Apache-2.0; die Lizenztexte werden nach
`extension/vendor/` kopiert. Die Sprachdaten `tessdata_fast` stehen ebenfalls unter
Apache-2.0.
