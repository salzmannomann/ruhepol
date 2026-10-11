/*
 * Läuft in der Seite selbst (world: MAIN), vor deren Skripten. Web-Komponenten legen ihre
 * Shadow-Bereiche oft erst nachträglich an (MSN: bis zu 7 Ebenen tief); dafür meldet der Browser
 * keine DOM-Änderung. Dieser Haken meldet jeden neuen offenen Shadow-Bereich mit einem Ereignis,
 * auf das content.js hört. Er ändert nichts am Verhalten der Seite und überträgt keine Daten.
 */
(function () {
  'use strict';
  const EVENT = '__ruhepol_shadow';
  const proto = Element.prototype;
  const orig = proto.attachShadow;
  if (typeof orig !== 'function' || orig.__ruhepol) return;
  function attachShadow(init) {
    const root = orig.call(this, init);
    if (init && init.mode === 'open') {
      const host = this;
      // Erst nach dem Konstruktor melden: dann ist meist schon Inhalt im Shadow-Bereich.
      queueMicrotask(() => {
        try { host.dispatchEvent(new CustomEvent(EVENT, { bubbles: true, composed: true })); } catch (_) { /* egal */ }
      });
    }
    return root;
  }
  Object.defineProperty(attachShadow, '__ruhepol', { value: true });
  Object.defineProperty(attachShadow, 'name', { value: 'attachShadow' });
  proto.attachShadow = attachShadow;
})();
