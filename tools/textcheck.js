/*
 * Schnelle Vorprüfung vor der Texterkennung: Kann in diesem Bild überhaupt Schrift stehen?
 * Schrift erzeugt in einer Zeile viele kurze, kontrastreiche Striche (hell → dunkel → hell im
 * Abstand einer Strichbreite), und das über mehrere Zellen nebeneinander. Glatte Fotos (Gesichter,
 * Himmel, Gebäude) haben das nicht; dann wird die Texterkennung (je Bild 0,3–2 s) übersprungen.
 * Im Zweifel „ja“: Laub, Rasen und Stoffmuster sehen schriftähnlich aus und werden weiter gelesen.
 * GEMESSEN UND VERWORFEN (1.30.2): trennt Bilder mit und ohne Schrift nicht sicher genug (README).
 * Nur noch für tools/bilder-pruefen.mjs. Stellt globalThis.SFTextCheck bereit.
 */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    edge: 28, // Helligkeitssprung zwischen Nachbarpixeln, ab dem eine Kante zählt (0–255)
    stroke: 14, // längste Strichbreite in px (Kante hin und zurück)
    cellW: 32,
    cellH: 8,
    cellStrokes: 1.2, // Striche je Zeile, ab denen eine Zelle schriftartig ist
    run: 2, // so viele schriftartige Zellen nebeneinander = mögliche Schriftzeile
  });

  /**
   * Kennzahlen für RGBA-Pixel (wie ImageData.data): längste Folge schriftartiger Zellen in einer
   * Zellenzeile und Zahl schriftartiger Zellen.
   */
  function measure(px, w, h, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const cols = Math.max(1, Math.floor(w / o.cellW));
    const rows = Math.max(1, Math.floor(h / o.cellH));
    const strokes = new Float32Array(cols * rows);
    const gray = new Uint8Array(w);
    for (let y = 0; y < rows * o.cellH; y++) {
      for (let x = 0, i = y * w * 4; x < w; x++, i += 4) gray[x] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
      const cy = Math.floor(y / o.cellH) * cols;
      // Strich: starke Kante in eine Richtung, innerhalb einer Strichbreite die Gegenkante.
      let lastX = -1000, lastSign = 0;
      for (let x = 0; x < w - 1; x++) {
        const d = gray[x + 1] - gray[x];
        if (d >= o.edge || d <= -o.edge) {
          const sign = d > 0 ? 1 : -1;
          if (sign !== lastSign && x - lastX <= o.stroke) {
            const cx = Math.floor(x / o.cellW);
            if (cx < cols) strokes[cy + cx] += 1;
            lastSign = 0; // Strich verbraucht
            lastX = x;
          } else {
            lastSign = sign;
            lastX = x;
          }
          // Kanten über mehrere Pixel (weiche Schrift) nur einmal zählen
          while (x < w - 2) {
            const d2 = gray[x + 2] - gray[x + 1];
            if ((sign > 0 && d2 >= o.edge / 2) || (sign < 0 && d2 <= -o.edge / 2)) x++;
            else break;
          }
        }
      }
    }
    let best = 0, texty = 0;
    const limit = o.cellStrokes * o.cellH;
    for (let r = 0; r < rows; r++) {
      let run = 0;
      for (let c = 0; c < cols; c++) {
        if (strokes[r * cols + c] >= limit) { run++; texty++; if (run > best) best = run; }
        else run = 0;
      }
    }
    return { run: best, texty, cells: cols * rows };
  }

  /** Kann Schrift im Bild stehen? (false = Texterkennung überspringen) */
  function mayHaveText(px, w, h, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    return measure(px, w, h, o).run >= o.run;
  }

  const api = { DEFAULTS, measure, mayHaveText };
  root.SFTextCheck = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
