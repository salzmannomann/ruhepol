# Ruhepol – Arbeitsregeln für Claude

Chrome-Erweiterung (MV3), die belastende Nachrichten-Inhalte lokal unscharf stellt: Schlagwortlisten,
Bildtext (OCR), lokales Sprachmodell (Bedeutungs-Filter), Lernfilter, Gemini Nano. Aufbau und alle
Messungen: `README.md`.

## Zusammenarbeit

- Kommunikation, Oberfläche, Kommentare, Commits und README auf **Deutsch**.
- Der Nutzer arbeitet nicht selbst im Code. Antworten klar und ohne Fachjargon, Entscheidungen begründen.
- **Alles lokal:** keine Server, keine Telemetrie, nichts verschicken. Netz nur für Tests und Messungen.
- Ruhepol soll den Nutzer **nicht befragen** (keine Rückfragen-Dialoge beim Surfen).
- Kein iPhone/iOS.

## Nur Gemessenes einbauen

- Jede Verbesserung **vorher/nachher messen** (echte Seiten: orf.at, derstandard.at, kurier.at, krone.at,
  heute.at, nachrichten.at …). Nur einbauen, was messbar besser ist. Gemessenes und Verworfenes mit Zahlen
  im README dokumentieren.
- Nach größeren Änderungen auch den **Gesamtvergleich** gegen einen älteren Stand laufen lassen
  (`tools/vergleich.mjs`). Einzelmessungen übersehen schleichende Verlangsamungen (so passiert mit den
  KI-Threads ab 1.23, entdeckt erst bei 1.30).
- Kosten im Hauptthread der Seite klein halten: keine Lageabfragen (`getBoundingClientRect`) in heißen
  Pfaden; Teures in Leerlaufzeiten (`requestIdleCallback`) oder über `IntersectionObserver`.

## Ablauf je Änderung

1. Änderung mit **Test** (`test/*.mjs`, Testseiten in `test/site/`). Ein neuer Testfall soll mit dem alten
   Stand fehlschlagen.
2. `npm test` muss grün sein (Unit + alle Playwright-Tests, ca. 20 min).
3. Version in `extension/manifest.json` **und** `package.json` hochzählen.
4. README ergänzen (Abschnitt + Messzahlen).
5. Commit auf dem Arbeitsbranch, pushen. Commit-Nachricht auf Deutsch, mit Versionsnummer in Klammern.
6. ZIP bauen: `tools/zip.sh` → `dist/ruhepol-<Version>.zip`, dem Nutzer schicken, **immer mit diesem
   Terminal-Befehl** dazu:
   ```
   f=$(ls -t ~/Downloads/ruhepol-*.zip | head -1) && rm -rf /tmp/rp && unzip -q "$f" -d /tmp/rp && rsync -a /tmp/rp/ruhepol/ ~/Documents/Chrome/ruhepol/ && echo "Aktualisiert mit $f"
   ```
   danach in `chrome://extensions` bei Ruhepol auf ↻.
7. Pull Request nach `main` **nur, wenn der Nutzer „mach nach main“ sagt**; dann PR anlegen und
   zusammenführen (Merge-Commit), Arbeitsbranch danach auf `main` vorspulen.

## Nie ins Repo

- `test/fixtures/real-headlines.json` (eingestufte echte Teaser, fremde Texte) – liegt nur lokal, ist in
  `.gitignore`. Testfälle aus echten Meldungen neutral umschreiben.
- Echte Schlagzeilen, Namen aus Nutzereinstellungen oder Protokoll-Exporten (z. B. eigene Schlagwörter
  des Nutzers) – weder in Code, Tests, README noch Commit-Nachrichten. Beispiele neutral wählen.
- `extension/vendor/` (wird von `npm run setup` erzeugt).

## Einrichten

```bash
npm install
npm run setup     # vendor/: tesseract, transformers.js, Sprachdaten, Sprachmodell (118 MB)
npm test
```

Das Modell `multilingual-e5-small` (quantisiert) wird vom Nutzer selbst in den Ordner gelegt; Link und
Prüfsumme stehen in `tools/HIER-MODELL-ABLEGEN.txt` (liegt jeder ZIP bei).

## Werkzeuge (`tools/`)

- `zip.sh` – ZIP zum Verteilen (ohne Testmodelle und ohne die Modelldatei, mit Hinweisdatei).
- `versionen.sh 1.21.0 aktuell` – ältere Stände nach `.vergleich/<Version>/extension` holen.
- `vergleich.mjs` + `auswertung.mjs` – Gesamtvergleich auf echten Seiten (Bilder unscharf, KI-Zeit,
  Blockierzeit, Treffer). Läuft headless mit `--disable-quic`, `--ignore-certificate-errors`, Mac-Kennung;
  Cookie-Abfragen werden beim Aufwärmen bestätigt.
- `profil.mjs` – CPU-Profil: Rechenzeit der Erweiterung im Hauptthread, teuerste Funktionen.
- `bilder-sammeln.mjs` → `bilder-pruefen.mjs` → `bilder-auswerten.js` – echte Nachrichtenbilder samt
  Texterkennungs-Ergebnis sammeln (nur lokal in `.vergleich/bilder/`) und eine Bild-Vorprüfung daran messen.
- `bilder-vorstufe.mjs [deu+eng|deu]` → `vorstufe-auswerten.js` – am selben Bildbestand Tesseract messen:
  Zeit je Bild (voll, nur Seitenaufteilung, nur Übergabe), gelesene Wörter, Regeln für eine Vorstufe.
- `bilder-nachlesen.mjs` → `nachlesen-auswerten.js` – Deutsch lesen, unsichere Zeilen mit Englisch nachlesen.
- `vergleich.mjs` mit `KI=0`: Bildzeiten ohne Wartezeit auf die KI.

Messungen schwanken (Seiten ändern sich, wenige Treffer je Seite): Stände abwechselnd laden, mehrere
Durchgänge, Mediane vergleichen, Rauschen im README benennen.

## Aufdeck-Protokoll

Der Nutzer kann unter Einstellungen → Erweitert ein Protokoll exportieren (`ruhepol-protokoll-*.json`) und
im Chat anhängen. Es enthält Einträge (aufgedeckt, automatisch, spät unscharf, selbst ausgeblendet,
bewertet) mit Grund, Liste, Text, Entscheidungsverlauf, Seitenausschnitt, Version, Einstellungen, dazu
Zähler je Seite und Tag. Daraus Fehlfälle ableiten, als neutrale Testfälle nachbauen, messen.
Inhalte daraus nie ins Repo.

## Offene Ideen (Stand 1.30.8)

Erledigt bis 1.30.8 (README): PPM statt BMP (Texterkennung doppelt so schnell), Schlagwortprüfung
302 → 170 ms, gleichmäßige Unschärfe, KI-Vorrang für wartende Bilder, winzige Rahmen erst bei sichtbarer
Größe, Bildergebnis ohne Warten aufs Speichern, Bildgröße aus dem IntersectionObserver. Gemessen und
verworfen: Tesseract-Vorstufe, „nur Deutsch“, Englisch nachlesen, kleinere Bilder, 3 OCR-Helfer auf 4
Kernen, Rahmenbilder nachrangig. Ein Bild braucht jetzt ~0,55 s bis scharf, fast nur Texterkennung.

1. **KI auf der Grafikkarte (WebGPU)** statt auf dem Prozessor: transformers.js kann das; offen, ob WebGPU
   im Offscreen Document geht. Messen auf dem Mac des Nutzers (eine Messseite in der Erweiterung), der
   Testrechner hat keine Grafikkarte. Würde dem Prozessor beim Laden gar keine Kerne mehr wegnehmen.
2. **Restliche Rechenzeit im Hauptthread** (~975 ms je Seitenaufruf, 15 s): `blockOk`/`findBlock`
   (Lage beim Blocksuchen, ~90 ms), `acceptNode` (~70 ms), `closestDeep` (~55 ms). Mit `tools/profil.mjs`.
3. **KI-Threads auf Rechnern mit 8+ Kernen:** Die Regel in `semantic-worker.js` ist nur auf 4 Kernen
   gemessen. Auf dem Mac des Nutzers nachprüfen, wenn sich die Gelegenheit ergibt.
