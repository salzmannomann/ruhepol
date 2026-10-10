/*
 * Content-Script: Text- und Bildfilter.
 * Läuft ab document_start, damit neue Bilder sofort unscharf gestellt werden können.
 */
(function () {
  'use strict';

  if (window.__schlagwortfilter) return;
  window.__schlagwortfilter = true;

  const { compile } = globalThis.SFMatch;
  const S = globalThis.SFSettings;
  const L = globalThis.SFLearn;

  const ATTRS = ['alt', 'title', 'aria-label'];
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'TEMPLATE', 'SVG', 'CODE', 'PRE', 'HEAD', 'TITLE', 'META', 'LINK']);
  const PRIMARY_BLOCKS = 'article, li, figure';
  const IDLE_BUDGET_MS = 8;
  const OBSERVER_THROTTLE_MS = 100;
  const OCR_MARGIN = '1200px'; // vorausschauend prüfen, damit Bilder beim Hinscrollen schon fertig sind
  // Schlagwort-Treffer zeigen, wenn das Modell sehr sicher "will ich sehen" sagt. Früher 20 % bei
  // 2 bekannten Wörtern – in Simulationen ließ das mit vielen Bewertungen belastende Meldungen
  // durch (Standard-Nutzer nach 100 Bewertungen: 36 statt 52 von 56 erkannt).
  const LEARN_KEEP = 0.05;
  const LEARN_KEEP_KNOWN = 4;
  const LEARN_CANDIDATES = 'article, li, figure, h1, h2, h3, h4';
  const OWN_CLASSES = ['sf-placeholder', 'sf-feedback', 'sf-toast'];
  const HOLD_MS = 2000;
  // Elemente, die typischerweise Hintergrundbilder tragen; Textauszeichnung (b, i, em …) nicht.
  const BG_TAGS = new Set(['DIV', 'A', 'SPAN', 'FIGURE', 'SECTION', 'HEADER', 'ARTICLE', 'LI', 'PICTURE', 'ASIDE', 'VIDEO']);
  const OBSERVE_OPTS = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'alt', 'title', 'aria-label', 'style', 'poster'],
  };
  // Regeln für offene Shadow-Roots (content.css wirkt dort nicht). Nur positive Selektoren,
  // damit nach dem Abschalten nichts unscharf bleibt.
  const SHADOW_CSS = `
    .sf-hidden, .sf-hidden-ph { display: none !important; }
    .sf-blurred { filter: blur(14px) !important; cursor: pointer !important; user-select: none !important; }
    img[data-sf="wait"], img[data-sf="pending"], img[data-sf="err"],
    [data-sf-bg="pending"], [data-sf-bg="err"] { filter: blur(18px) !important; }
    .sf-placeholder { display: block !important; margin: 6px 0 !important; padding: 8px 12px !important;
      border: 1px dashed #9a9a9a !important; border-radius: 6px !important; background: #f3f3f3 !important;
      color: #444 !important; font: 14px/1.4 system-ui, sans-serif !important; cursor: pointer !important; }
    .sf-pick { outline: 3px dashed #3d5afe !important; outline-offset: 2px !important; }`;

  let settings = null;
  let matcher = null;
  let mildMatcher = null; // nur die milden Vorschlagslisten (Wirtschaft, Krise & Skandal)
  let strongMatcher = null; // alles andere inkl. eigener Schlagwörter
  let active = false;
  let generation = 0; // erhöht sich bei jedem Neustart; alte OCR-Antworten werden verworfen

  const hitBlocks = new Set();
  const pendingRoots = new Set();
  let idleHandle = null;
  let activeWalker = null;
  let observer = null;
  let io = null;
  let mutationTimer = null;
  const mutationBuffer = [];

  let model = null; // Lernmodell (aus chrome.storage.local)
  let clearedBlocks = new WeakSet(); // vom Lernfilter freigegeben
  let weakChecked = new WeakSet(); // Artikel-Absätze mit nur einem milden Treffer, schon geprüft
  let scoredBlocks = new WeakSet(); // vom Lernfilter schon bewertet
  const learnCandidates = new Set();
  let learnHandle = null;
  let lastCtxTarget = null;
  const shadowRoots = new Set(); // beobachtete offene Shadow-Roots
  const bgQueue = new Set(); // Elemente, deren Hintergrundbild noch geprüft wird
  let bgHandle = null;
  let shadowSheet = null;
  let zoneRules = []; // Bereichsregeln für diese Seite

  /* ---------------- Feste Bedienoberfläche ---------------- */

  // Knöpfe, Menüs und Navigation sind keine Meldungen („KI-Modus“ bei Google, Menüpunkt „Klima“).
  const UI_MENUS = 'nav, [role="navigation"], [role="menubar"], [role="menu"], [role="tablist"], [role="toolbar"]';
  const UI_CONTROLS = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], ' +
    '[role="menuitemcheckbox"], [role="option"], [role="switch"], [role="search"], label, ' + UI_MENUS;
  // Kopf- und Fußbereich der Seite. Ein <header> innerhalb eines Artikels gehört zum Inhalt
  // (derStandard: Überschrift und Vorspann jedes Teasers stehen in einem <header>).
  const PAGE_BARS = 'header, footer, [role="banner"], [role="contentinfo"]';
  const UI_MAX_WORDS = 6;

  /**
   * Liegt der Treffer in fester Bedienoberfläche statt in einem Inhalt? Nur bei kurzen Texten:
   * Teaser in Aufklapp-Menüs oder ein Eilmeldungs-Band im Seitenkopf bleiben gefiltert.
   */
  function isPageChrome(el, block) {
    const node = el && el.nodeType === 1 ? el : block;
    if (!node || !node.closest) return false;
    const words = blockText(block).split(/\s+/).filter(Boolean).length;
    if (words > UI_MAX_WORDS) return false;
    // Überschriften sind Inhalt, auch als „Knopf“ (orf.at: Video-Titel sind <a role="button"> in <h3>).
    if (node.closest('h1, h2, h3, h4, h5, h6') || block.matches('h1, h2, h3, h4') || block.querySelector('h1, h2, h3, h4')) return false;
    if (node.closest(UI_CONTROLS)) return true;
    // Bilder nur in Knöpfen und Menüs (Symbole); ein Aufmacherbild im Seitenkopf ist Inhalt.
    if (node.tagName === 'IMG') return false;
    const bar = node.closest(PAGE_BARS);
    if (!bar || bar.closest('article, [role="article"]')) return false;
    const a = node.closest('a[href]') || block.querySelector('a[href]');
    return !(a && looksLikeArticleLink(a));
  }

  /** Link auf eine einzelne Meldung (lange Adresse oder Artikelnummer), nicht auf eine Rubrik. */
  function looksLikeArticleLink(a) {
    try {
      const u = new URL(a.href, location.href);
      return /\d{5,}/.test(u.pathname) || u.pathname.split('/').some((seg) => seg.length > 30);
    } catch (_) {
      return false;
    }
  }

  /* ---------------- Bewusst geöffnete Artikel ---------------- */

  // Automatische Gründe; was die Person selbst gesperrt hat (👎, Bereiche), gilt weiter.
  const AUTO_WHY = new Set(['text', 'bildtext', 'ocr', 'ki', 'gelernt']);
  let trustedPage = false;
  let articleRoot = null;

  /** Klick (auch Mittelklick, Strg-Klick, „In neuem Tab öffnen“) auf einen sichtbaren Link merken. */
  function onLinkIntent(ev) {
    if (!active || !settings || !settings.trustOpened) return;
    if (ev.type === 'click' && ev.button !== 0) return;
    if (ev.type === 'auxclick' && ev.button !== 1) return;
    const path = ev.composedPath ? ev.composedPath() : [ev.target];
    let a = path.find((n) => n && n.tagName === 'A' && n.href);
    if (!a) {
      // Teaser-Karten, bei denen die Überschrift nicht im Link steht (z. B. derStandard: ein Link
      // liegt über der ganzen Karte bzw. die Karte navigiert per Skript): Hauptlink der Karte.
      const t = path.find((n) => n && n.nodeType === 1);
      const card = t && t.closest && t.closest('article, li');
      a = card && card.querySelector('a[href]');
    }
    if (!a || !/^https?:/i.test(a.href)) return;
    if (a.closest('[data-sf-hit], .sf-placeholder')) return; // unscharf/ausgeblendet: nicht bewusst gewählt
    try { chrome.runtime.sendMessage({ type: 'trustLink', url: a.href }).catch(() => {}); } catch (_) { /* neu geladen */ }
  }

  /** Artikelbereich: Container der Hauptüberschrift (article/main) bzw. Vorfahr mit Fließtext. */
  function trustArea() {
    if (articleRoot && articleRoot.isConnected) return articleRoot;
    const h1 = [...document.getElementsByTagName('h1')].find((h) => h.textContent.trim().length > 10);
    if (!h1) return null;
    let root = h1.closest('article, main, [role="main"]');
    if (!root) {
      for (let cur = h1.parentElement, i = 0; cur && cur !== document.body && i < 6; cur = cur.parentElement, i++) {
        if (cur.getElementsByTagName('p').length >= 3) { root = cur; break; }
      }
    }
    articleRoot = root;
    return root;
  }

  /** Liegt der Block im Artikel selbst (nicht in Teaser-Leisten, Navigation, Fußzeile)? */
  function inTrustedArea(block) {
    if (!trustedPage || !settings.trustOpened || !block) return false;
    const root = trustArea();
    if (!root || !root.contains(block)) return false;
    if (block.closest('aside, nav, footer, [role="complementary"]')) return false;
    // Teaser-Karten im Artikel („Mehr zum Thema“): verlinkte Überschrift
    if (block !== root && block.matches('article, li, section, div') &&
        block.querySelector('a h2, a h3, a h4, h2 a, h3 a, h4 a')) return false;
    return true;
  }

  /* ---------------- Start / Einstellungen ---------------- */

  async function init() {
    // Nur HTML-Dokumente (keine XML-Ansichten wie RSS/Sitemaps: dort fehlen style und dataset).
    if (!(document.documentElement instanceof HTMLElement)) return;
    const [s, local] = await Promise.all([S.load(), chrome.storage.local.get('model')]);
    settings = s;
    model = local.model || null;
    // Über einen sichtbaren Teaser geöffnet? Vor dem ersten Ausblenden klären (nur Hauptseite).
    if (settings.trustOpened && window === window.top) {
      try {
        const r = await withTimeout(chrome.runtime.sendMessage({ type: 'isTrusted', url: location.href }), 400);
        trustedPage = !!(r && r.trusted);
      } catch (_) { /* dann normal filtern */ }
    }
    for (const type of ['click', 'auxclick', 'contextmenu']) document.addEventListener(type, onLinkIntent, true);
    apply();
    // Sprachmodell und Bezugstexte schon laden, während die Seite noch aufbaut.
    if (active && semanticOn()) chrome.runtime.sendMessage({ type: 'semWarm' }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.model) return;
      const wasHiding = learningHides();
      model = changes.model.newValue || null;
      // Modell ist erstmals einsatzbereit (oder nicht mehr): neu starten, sonst nur weiterverwenden.
      if (learningHides() !== wasHiding) apply();
    });
    document.addEventListener('contextmenu', (e) => { lastCtxTarget = e.target; }, true);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (!S.KEYS.some((k) => k in changes)) return;
      S.load().then((s) => {
        settings = s;
        apply();
      });
    });
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'getFrameCount') sendResponse({ n: hitBlocks.size });
      if (msg && msg.type === 'ctx') onContextAction(msg.action);
      if (msg && msg.type === 'toast' && msg.text) toast(String(msg.text));
      return false;
    });
  }

  function apply() {
    teardown();
    const host = location.hostname || (window.top !== window ? safeTopHost() : '');
    const keywords = S.allKeywords(settings);
    zoneRules = settings.zones.filter((z) => S.hostInList(location.hostname, [z.host]));
    const shouldRun = S.isActiveOn(settings, host) &&
      (keywords.length > 0 || learningHides() || settings.semantic || zoneRules.length > 0);
    if (!shouldRun) {
      reportCount();
      return;
    }
    // Eingebaute Ausnahmen gelten nur, wenn Vorschlagslisten aktiv sind (eigene Wörter bleiben unberührt).
    const allow = settings.presets.length ? settings.allow.concat(globalThis.SFPresets.ALLOW) : settings.allow;
    const opts = { partial: settings.partial, fuzzy: settings.fuzzy, allow };
    matcher = compile(keywords, opts);
    // Für Artikel-Absätze: Treffer aus milden Listen getrennt zählen (siehe checkText).
    const P = globalThis.SFPresets;
    const mildIds = settings.presets.filter((id) => P.MILD_IDS.includes(id));
    mildMatcher = compile(P.termsFor(mildIds), opts);
    strongMatcher = compile(settings.keywords.concat(P.termsFor(settings.presets.filter((id) => !mildIds.includes(id)))), opts);
    clearedBlocks = new WeakSet();
    weakChecked = new WeakSet();
    scoredBlocks = new WeakSet();
    active = true;
    generation++;
    document.documentElement.classList.add('sf-active');
    document.documentElement.style.setProperty('--sf-min-w', settings.minWidth + 'px');

    io = new IntersectionObserver(onIntersect, { rootMargin: OCR_MARGIN });
    observer = new MutationObserver(onMutations);
    observer.observe(document, OBSERVE_OPTS);
    document.addEventListener('load', onLoadCapture, true);
    document.addEventListener('error', onErrorCapture, true);
    document.addEventListener('pointerdown', onPendingDown, true);
    document.addEventListener('click', onPendingClick, true);

    // Bilder sofort markieren, Text dann im Leerlauf prüfen.
    enqueue(document.documentElement);
    applyZones();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { if (active) { enqueue(document.documentElement); applyZones(); } }, { once: true });
    }
    reportCount();
  }

  function learningActive() {
    return !!settings && settings.learn && L.ready(model);
  }

  function learningHides() {
    return learningActive() && settings.learnHide;
  }

  function safeTopHost() {
    try { return window.top.location.hostname; } catch (_) { return ''; }
  }

  function contextGone() {
    try { return !chrome.runtime || !chrome.runtime.id; } catch (_) { return true; }
  }

  function teardown() {
    active = false;
    if (observer) observer.disconnect();
    if (io) io.disconnect();
    observer = io = null;
    clearTimeout(mutationTimer);
    mutationTimer = null;
    mutationBuffer.length = 0;
    pendingRoots.clear();
    activeWalker = null;
    ocrWaiting.clear();
    learnCandidates.clear();
    semQueue.clear();
    semUnavailable = false;
    toneQueue.clear();
    toneUnavailable = false;
    vetoQueue.clear();
    nanoQueue.clear();
    nanoUnavailable = false;
    clearTimeout(vetoTimer);
    vetoTimer = null;
    clearTimeout(toneTimer);
    toneTimer = null;
    bgQueue.clear();
    if (bgHandle) cancelIdle(bgHandle);
    bgHandle = null;
    if (idleHandle) cancelIdle(idleHandle);
    if (learnHandle) cancelIdle(learnHandle);
    idleHandle = learnHandle = null;
    document.removeEventListener('load', onLoadCapture, true);
    document.removeEventListener('error', onErrorCapture, true);
    document.removeEventListener('pointerdown', onPendingDown, true);
    document.removeEventListener('click', onPendingClick, true);
    document.documentElement.classList.remove('sf-active');
    for (const el of document.querySelectorAll('.sf-placeholder, .sf-feedback')) el.remove();
    cancelHold();
    for (const el of document.querySelectorAll('[data-sf-hit]')) {
      el.classList.remove('sf-hidden', 'sf-blurred', 'sf-hidden-ph');
      el.removeEventListener('click', onBlurClick, true);
      el.removeEventListener('pointerdown', onBlurDown, true);
      delete el.dataset.sfHit;
    }
    hitBlocks.clear();
    for (const el of document.querySelectorAll('img[data-sf], [data-sf-bg]')) {
      delete el.dataset.sf;
      delete el.dataset.sfBg;
      delete el.dataset.sfSrc;
    }
    for (const root of shadowRoots) {
      for (const el of root.querySelectorAll('.sf-placeholder')) el.remove();
      for (const el of root.querySelectorAll('[data-sf-hit]')) {
        el.classList.remove('sf-hidden', 'sf-blurred', 'sf-hidden-ph');
        el.removeEventListener('click', onBlurClick, true);
        el.removeEventListener('pointerdown', onBlurDown, true);
        delete el.dataset.sfHit;
      }
      for (const el of root.querySelectorAll('img[data-sf], [data-sf-bg]')) {
        delete el.dataset.sf;
        delete el.dataset.sfBg;
        delete el.dataset.sfSrc;
      }
      root.removeEventListener('load', onLoadCapture, true);
      root.removeEventListener('error', onErrorCapture, true);
      if (shadowSheet) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((x) => x !== shadowSheet);
    }
    shadowRoots.clear();
    hitBlocks.clear();
  }

  /* ---------------- Shadow-DOM (offene Shadow-Roots) ---------------- */

  function watchShadow(root) {
    if (!active || shadowRoots.has(root)) return;
    shadowRoots.add(root);
    try {
      if (!shadowSheet) {
        shadowSheet = new CSSStyleSheet();
        shadowSheet.replaceSync(SHADOW_CSS);
      }
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, shadowSheet];
    } catch (_) { /* ältere Browser */ }
    observer.observe(root, OBSERVE_OPTS);
    // load/error steigen nicht aus dem Shadow-DOM auf: dort eigene Listener.
    root.addEventListener('load', onLoadCapture, true);
    root.addEventListener('error', onErrorCapture, true);
    enqueue(root);
  }

  /* ---------------- Planung (requestIdleCallback, gedrosselter Observer) ---------------- */

  const requestIdle = window.requestIdleCallback
    ? (cb) => window.requestIdleCallback(cb, { timeout: 500 })
    : (cb) => setTimeout(() => cb({ timeRemaining: () => IDLE_BUDGET_MS, didTimeout: true }), 16);
  const cancelIdle = window.cancelIdleCallback || clearTimeout;

  function enqueue(node) {
    if (!active || !node) return;
    // Bilder sofort unscharf stellen (nicht erst im Leerlauf).
    if (node.nodeType === 1 || node.nodeType === 11) markImagesNow(node);
    pendingRoots.add(node);
    if (!idleHandle) idleHandle = requestIdle(work);
  }

  function work(deadline) {
    idleHandle = null;
    if (!active) return;
    const start = performance.now();
    const budget = () => (deadline.didTimeout ? IDLE_BUDGET_MS - (performance.now() - start) : deadline.timeRemaining());
    // Große Teilbäume werden über einen fortsetzbaren TreeWalker in Häppchen abgearbeitet.
    outer: while (true) {
      if (!activeWalker) {
        const next = pendingRoots.values().next();
        if (next.done) break;
        pendingRoots.delete(next.value);
        if (next.value.isConnected) activeWalker = scanNode(next.value);
        if (!activeWalker) { if (budget() <= 1) break; continue; }
      }
      let n, i = 0;
      while ((n = activeWalker.nextNode())) {
        if (n.nodeType === 3) checkText(n.parentElement, n.nodeValue);
        else checkElementAttrs(n);
        if (++i % 64 === 0 && budget() <= 1) break outer;
      }
      activeWalker = null;
      if (budget() <= 1) break;
    }
    if (pendingRoots.size || activeWalker) idleHandle = requestIdle(work);
    else flushOcr();
    // Lernfilter/Sprachmodell nicht erst nach dem ganzen Textscan: auf Seiten mit Tickern wird der
    // nie fertig. Ein Block, der danach noch ein Schlagwort trifft, wird einfach übersprungen.
    scheduleLearn();
    reportCount();
  }

  function onMutations(records) {
    for (const r of records) mutationBuffer.push(r);
    // Bilder dürfen nicht kurz scharf aufblitzen: neue <img> sofort markieren.
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) if (n.nodeType === 1 && !isOwn(n)) markImagesNow(n);
      } else if (r.type === 'attributes' && (r.attributeName === 'src' || r.attributeName === 'srcset')) {
        const img = r.target.tagName === 'IMG' ? r.target : r.target.parentElement && r.target.parentElement.querySelector('img');
        if (img) markImagesNow(img);
      }
    }
    if (!mutationTimer) mutationTimer = setTimeout(flushMutations, OBSERVER_THROTTLE_MS);
  }

  function flushMutations() {
    mutationTimer = null;
    const recs = mutationBuffer.splice(0);
    for (const r of recs) {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) {
          if (n.nodeType === 1 && !isOwn(n)) enqueue(n);
          else if (n.nodeType === 3) enqueue(n);
        }
      } else if (r.type === 'characterData') {
        enqueue(r.target);
      } else if (r.type === 'attributes') {
        const el = r.target;
        if (r.attributeName === 'style' || r.attributeName === 'poster') {
          if (!isOwn(el)) queueBackground(el); // gebündelt im Leerlauf, nicht bei jeder Animation sofort
          continue;
        }
        if (el.tagName === 'IMG' || el.tagName === 'SOURCE') {
          const img = el.tagName === 'IMG' ? el : el.parentElement && el.parentElement.querySelector('img');
          if (img) processImage(img);
        } else {
          enqueue(el);
        }
      }
    }
    if (zoneRules.length) applyZones();
    if (!pendingRoots.size) flushOcr();
    scheduleLearn();
  }

  function isOwn(n) {
    return !!n.classList && OWN_CLASSES.some((c) => n.classList.contains(c));
  }

  /* ---------------- Text ---------------- */

  /** Prüft den Knoten selbst und liefert einen TreeWalker für seine Nachfahren (oder null). */
  function scanNode(root) {
    if (root.nodeType === 3) {
      checkText(root.parentElement, root.nodeValue);
      return null;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return null;
    const start = root.nodeType === 9 ? root.documentElement : root;
    if (!start) return null;
    if (start.nodeType === 1) {
      if (skipElement(start)) return null;
      checkElementAttrs(start);
    }
    return document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (SKIP_TAGS.has(n.tagName.toUpperCase()) || n.isContentEditable || n.dataset.sfHit || n.dataset.sfRevealed || isOwn(n)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
        return n.nodeValue.length > 2 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
  }

  function skipElement(el) {
    if (SKIP_TAGS.has(el.tagName.toUpperCase()) || isOwn(el)) return true;
    return !!el.closest('[data-sf-hit], [data-sf-revealed], .sf-placeholder, .sf-feedback, .sf-toast, [contenteditable=""], [contenteditable="true"]');
  }

  function checkText(el, text) {
    if (!el || !text || !matcher) return;
    if (el.closest('[data-sf-hit], [data-sf-revealed]')) return;
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return;
    const kw = matcher.find(text);
    if (!kw) return;
    const block = findBlock(el);
    if (isArticleParagraph(block) && onlyOneMildHit(block)) {
      // Einzelner Treffer aus einer milden Liste mitten im Fließtext (z. B. „Massenentlassungen“
      // in einem historischen Rückblick): nur unscharf, wenn das Sprachmodell zustimmt.
      if (!weakChecked.has(block)) {
        weakChecked.add(block);
        if (semanticOn()) { semQueue.add(block); flushSem(); }
      }
      return;
    }
    hit(el, kw, { why: 'text', block });
  }

  /** Absatz eines längeren Fließtexts (Artikelseite), keine Schlagzeile und kein Teaser. */
  function isArticleParagraph(block) {
    return block && block.tagName === 'P' && block.textContent.length > 200 && !!block.parentElement &&
      block.parentElement.querySelectorAll(':scope > p').length >= 3;
  }

  function onlyOneMildHit(block) {
    const text = blockText(block);
    if (strongMatcher.find(text)) return false;
    return mildMatcher.findAll(text, 2).length < 2;
  }

  function checkElementAttrs(el) {
    if (el.shadowRoot) watchShadow(el.shadowRoot);
    if (el.tagName === 'IMG') {
      processImage(el);
      return;
    }
    if (BG_TAGS.has(el.tagName)) queueBackground(el);
    if (learnHandleable() && el.matches(LEARN_CANDIDATES)) learnCandidates.add(el);
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && !isTagList(v)) {
        const kw = matcher.find(v);
        if (kw) { hit(el, kw, { why: 'text' }); return; }
      }
    }
  }

  /* ---------------- Bilder ---------------- */

  function markImagesNow(root) {
    if (!active) return;
    if (root.tagName === 'IMG') { processImage(root); return; }
    if (root.getElementsByTagName) {
      const imgs = root.getElementsByTagName('img');
      for (let i = 0; i < imgs.length; i++) processImage(imgs[i]);
    } else if (root.querySelectorAll) {
      for (const img of root.querySelectorAll('img')) processImage(img);
    }
  }

  function imageSize(img) {
    const r = img.getBoundingClientRect();
    const w = r.width || img.naturalWidth || Number(img.getAttribute('width')) || 0;
    const h = r.height || img.naturalHeight || Number(img.getAttribute('height')) || 0;
    return { w, h };
  }

  /**
   * Zustände (data-sf): wait (noch nicht geladen, per CSS unscharf), small, pending (unscharf,
   * Prüfung läuft), ok, hit, err.
   */
  function processImage(img) {
    if (!active || img.dataset.sfRevealed) return;
    // Im aufgedeckten Block nachgeladen: gleich mit aufdecken (sonst bliebe es per CSS unscharf).
    if (img.closest('[data-sf-revealed]')) { img.dataset.sfRevealed = '1'; return; }
    if (img.closest('[data-sf-hit]')) return;
    // Bewusst geöffneter Artikel: Fotos im Artikel gar nicht erst prüfen.
    if (trustedPage && inTrustedArea(findBlock(img))) { img.dataset.sf = 'ok'; return; }
    // Vorauswahl: Bildhinweise (alt, title, aria-label, figcaption) sofort prüfen, noch bevor
    // das Bild geladen ist. Bei Treffer wird der Block gleich ausgeblendet; OCR entfällt dann,
    // und ausgeblendete Lazy-Bilder werden oft gar nicht erst geladen.
    const kw = matcher.find(imageContextText(img));
    if (kw) { hitImage(img, kw, 'bildtext'); return; }

    const src = img.currentSrc || img.src || '';
    if (!src) { img.dataset.sf = 'wait'; return; }
    if (img.dataset.sfSrc === src && img.dataset.sf && img.dataset.sf !== 'wait') return;

    if (!img.complete || !img.naturalWidth) {
      // Noch nicht geladen: unscharf lassen und beim load-Event (Capture) erneut prüfen.
      img.dataset.sf = 'wait';
      return;
    }

    const { w, h } = imageSize(img);
    img.dataset.sfSrc = src;
    if (w < settings.minWidth || h < settings.minHeight) {
      img.dataset.sf = 'small';
      return;
    }
    // Lazy-Loading-Platzhalter (z. B. 1×1-GIF, groß dargestellt): auf das echte Bild warten.
    if (img.naturalWidth <= 4 && img.naturalHeight <= 4) {
      img.dataset.sf = 'wait';
      delete img.dataset.sfSrc;
      return;
    }
    img.dataset.sf = 'pending';
    if (!settings.ocr) { img.dataset.sf = 'ok'; return; }
    if (io) io.observe(img);
  }

  /* ---------------- Hintergrundbilder und Video-Vorschaubilder ---------------- */

  /** Zustand eines geprüften Elements: <img> in data-sf, alles andere in data-sf-bg. */
  function getState(el) { return el.tagName === 'IMG' ? el.dataset.sf : el.dataset.sfBg; }
  function setState(el, v) { if (el.tagName === 'IMG') el.dataset.sf = v; else el.dataset.sfBg = v; }

  function bgUrl(el) {
    if (el.tagName === 'VIDEO') {
      const p = el.getAttribute('poster');
      return p ? absUrl(p) : null;
    }
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none' || bg.indexOf('url(') === -1) return null;
    const m = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(bg);
    if (!m || !m[2] || m[2].startsWith('data:image/svg')) return null;
    return absUrl(m[2]);
  }

  function absUrl(u) {
    try { return new URL(u, document.baseURI).href; } catch (_) { return null; }
  }

  /**
   * Hintergrundbilder werden in einer eigenen Warteschlange nur mit echter Leerlaufzeit geprüft:
   * getComputedStyle kann eine Stilberechnung erzwingen, die soll nicht mitten im Laden passieren.
   */
  function queueBackground(el) {
    bgQueue.add(el);
    if (!bgHandle && active) bgHandle = window.requestIdleCallback ? requestIdleCallback(bgWork, { timeout: 2000 }) : setTimeout(() => bgWork({ timeRemaining: () => 8, didTimeout: true }), 50);
  }

  function bgWork(deadline) {
    bgHandle = null;
    if (!active) { bgQueue.clear(); return; }
    const start = performance.now();
    const budget = () => (deadline.didTimeout ? IDLE_BUDGET_MS - (performance.now() - start) : deadline.timeRemaining());
    let i = 0;
    for (const el of bgQueue) {
      bgQueue.delete(el);
      if (el.isConnected) checkBackground(el);
      if (++i % 32 === 0 && budget() <= 1) break;
    }
    if (bgQueue.size) queueBackground(bgQueue.values().next().value);
  }

  /** Prüft CSS-Hintergrundbild bzw. Video-Poster eines Elements (nicht <img>). */
  function checkBackground(el) {
    if (!active || el.nodeType !== 1 || el === document.body || el === document.documentElement) return;
    if (SKIP_TAGS.has(el.tagName.toUpperCase()) || el.dataset.sfRevealed) return;
    const url = bgUrl(el);
    if (!url) return;
    if (el.dataset.sfSrc === url && el.dataset.sfBg) return;
    if (el.closest('[data-sf-hit], [data-sf-revealed]')) return;
    const r = el.getBoundingClientRect();
    const w = r.width || Number(el.getAttribute('width')) || 0;
    const h = r.height || Number(el.getAttribute('height')) || 0;
    if (w < settings.minWidth || h < settings.minHeight) return;
    // Seitenhintergründe und riesige Flächen nicht anfassen.
    if (w > window.innerWidth * 0.95 && h > window.innerHeight * 0.8) return;
    el.dataset.sfSrc = url;
    const kw = matcher.find([el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' '));
    if (kw) { hitImage(el, kw, 'bildtext'); return; }
    el.dataset.sfBg = 'pending';
    if (!settings.ocr) { el.dataset.sfBg = 'ok'; return; }
    if (io) io.observe(el);
  }

  /**
   * Agenturfotos tragen oft eine Schlagwortliste als alt-Text („Geld, Münzen, Eurokrise,
   * Finanzkrise, …“). Die beschreibt das Symbolbild, nicht die Meldung – daher ignorieren.
   */
  function isTagList(text) {
    const items = String(text || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    return items.length >= 6 && items.every((x) => x.split(/\s+/).length <= 3);
  }

  function imageContextText(img) {
    const parts = [img.getAttribute('alt'), img.getAttribute('title'), img.getAttribute('aria-label')]
      .filter((t) => !isTagList(t));
    const fig = img.closest('figure');
    if (fig) {
      const cap = fig.querySelector('figcaption');
      if (cap) parts.push(cap.textContent);
    }
    return parts.filter(Boolean).join(' \n ');
  }

  const ocrWaiting = new Map(); // Bild -> Zeitpunkt, seit dem es auf OCR wartet

  function onIntersect(entries) {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      if (!ocrWaiting.has(e.target)) ocrWaiting.set(e.target, performance.now());
    }
    flushOcr();
  }

  /**
   * OCR erst starten, wenn der Textscan durch ist: Steht das Schlagwort schon im Teaser-Text,
   * ist der Block bereits ausgeblendet und das Bild muss nicht gelesen werden.
   */
  const OCR_MAX_WAIT_MS = 400; // Texterkennung kostet nur noch ~0,2 s: nicht lange auf den Textscan warten
  let ocrWaitTimer = null;

  function flushOcr() {
    // Normalerweise erst nach dem Textscan; auf Seiten, die sich ständig ändern (Ticker,
    // Werbung), aber spätestens nach OCR_MAX_WAIT_MS, damit Bilder nicht ewig unscharf bleiben.
    const busy = pendingRoots.size || activeWalker || mutationTimer;
    const now = performance.now();
    for (const [img, since] of ocrWaiting) {
      if (busy && now - since < OCR_MAX_WAIT_MS) continue;
      ocrWaiting.delete(img);
      if (!img.isConnected || img.closest('[data-sf-hit], [data-sf-revealed]')) continue;
      runOcr(img);
    }
    clearTimeout(ocrWaitTimer);
    ocrWaitTimer = ocrWaiting.size ? setTimeout(flushOcr, OCR_MAX_WAIT_MS) : null;
  }

  async function runOcr(img) {
    const src = img.dataset.sfSrc;
    if (!src || getState(img) !== 'pending') return;
    const gen = generation;
    let res;
    try {
      const msg = { type: 'ocr', url: src };
      if (src.startsWith('blob:')) msg.dataUrl = await blobUrlToDataUrl(src);
      res = await withTimeout(chrome.runtime.sendMessage(msg), 60000);
    } catch (e) {
      // Erweiterung aktualisiert/entfernt: dieses alte Skript abschalten statt Bilder zu verstecken.
      if (contextGone()) { teardown(); return; }
      res = { ok: false, error: String(e) };
    }
    if (gen !== generation || !active) return;
    if (img.dataset.sfSrc !== src || getState(img) !== 'pending') return; // Bild hat inzwischen gewechselt
    if (res && res.ok) {
      img.__sfOcr = res.text;
      const kw = matcher.find(res.text);
      if (kw) hitImage(img, kw, 'ocr');
      else {
        setState(img, 'ok');
        // Der Bildtext kann für den Lernfilter den Ausschlag geben.
        if (learnHandleable()) {
          const block = findBlock(img);
          scoredBlocks.delete(block);
          learnCandidates.add(block);
          scheduleLearn();
        }
      }
    } else {
      onOcrError(img);
    }
    reportCount();
  }

  function onOcrError(img) {
    if (settings.onError === 'hide') hitImage(img, 'Bild nicht prüfbar', 'fehler');
    else if (settings.onError === 'blur') setState(img, 'err');
    else setState(img, 'ok');
  }

  async function blobUrlToDataUrl(url) {
    const blob = await (await fetch(url)).blob();
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Zeitüberschreitung')), ms))]);
  }

  function onLoadCapture(e) {
    const t = e.target;
    if (t && t.tagName === 'IMG') processImage(t);
  }

  function onErrorCapture(e) {
    const t = e.target;
    if (t && t.tagName === 'IMG' && !t.naturalWidth) t.dataset.sf = 'small'; // kaputtes Bild: nichts zu prüfen
  }

  function hitImage(img, kw, why) {
    setState(img, 'hit');
    // Block bleibt sichtbar (bestätigt harmlos, gelernt, schon aufgedeckt): Bild nicht unscharf lassen.
    if (!hit(img, kw, { why })) setState(img, 'ok');
  }


  /* ---------------- Inhaltsblock finden und ausblenden ---------------- */

  function blockOk(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const tag = el.tagName;
    if (tag === 'MAIN' || tag === 'BODY' || tag === 'HTML') return false;
    const role = el.getAttribute('role');
    if (role === 'main' || role === 'feed') return false;
    // Enthält der Block selbst viele Beiträge, ist es eine Liste/Spalte und kein einzelner Inhalt.
    if (el.querySelectorAll('article, li').length >= 4) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return true; // nicht gerendert: Größe unbekannt
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    if (r.height > vh * 1.5) return false;
    if (r.width > vw * 0.9 && r.height > vh * 0.6) return false;
    return true;
  }

  function findBlock(el) {
    // Artikelseiten: Steht der Treffer in einem Absatz eines längeren Fließtexts, nur diesen
    // Absatz nehmen – nicht den ganzen Textbereich samt Fotos.
    const para = el.closest && el.closest('p');
    if (para && para.parentElement && para.textContent.length > 40 &&
        para.parentElement.querySelectorAll(':scope > p').length >= 3) {
      return para;
    }
    let primary = null, section = null, link = null;
    let depth = 0;
    for (let cur = el; cur && cur !== document.body && depth < 15; cur = cur.parentElement, depth++) {
      if (cur.matches(PRIMARY_BLOCKS)) {
        if (blockOk(cur)) { primary = cur; break; }
      } else if (!section && cur.tagName === 'SECTION') {
        if (blockOk(cur)) section = cur;
      } else if (!link && cur.tagName === 'A') {
        if (blockOk(cur)) link = cur;
      }
    }
    if (primary) return primary;
    // Kein article/li/figure (z. B. orf.at: div-Teaser mit Überschrift + Text):
    // vom Link bzw. vom Element aus bis zum Teaser-Container erweitern.
    let base = link || el;
    if (base === el && el.tagName !== 'IMG') {
      for (let cur = el, d = 0; cur && cur !== document.body && d < 4; cur = cur.parentElement, d++) {
        const disp = getComputedStyle(cur).display;
        if ((disp === 'block' || disp === 'flex' || disp === 'grid' || disp === 'list-item') && blockOk(cur)) { base = cur; break; }
      }
    }
    const teaser = expandTeaser(base);
    if (teaser !== base) return teaser;
    if (section && !link && section.contains(base)) return section;
    return base;
  }

  /** Größter Vorfahre (max. 6 Ebenen), der höchstens eine Überschrift und wenige Links enthält. */
  function expandTeaser(el) {
    let best = el;
    for (let cur = el.parentElement, d = 0; cur && d < 6; cur = cur.parentElement, d++) {
      if (cur === document.body || cur === document.documentElement || cur.tagName === 'MAIN') break;
      if (cur.querySelectorAll('h1, h2, h3, h4, h5, h6').length > 1) break;
      if (cur.querySelectorAll('a[href]').length > 6) break;
      if (cur.querySelectorAll('img').length > 3) break;
      // Nicht über ein Menü hinweg erweitern (Eilmeldung im Seitenkopf ≠ ganzer Kopf samt Navigation).
      if ([...cur.querySelectorAll(UI_MENUS)].some((m) => !m.contains(el))) break;
      if (!blockOk(cur)) break;
      best = cur;
    }
    return best;
  }

  /* ---------------- Lernfilter ---------------- */

  /** Sollen Teaser für Lernfilter bzw. Bedeutungs-Filter gesammelt werden? */
  function learnHandleable() {
    return active && (learningHides() || semanticOn());
  }

  function semanticOn() {
    return !!settings && settings.semantic && !semUnavailable;
  }

  function scheduleLearn() {
    if (learnCandidates.size && !learnHandle && active) learnHandle = requestIdle(learnWork);
  }

  /** Text eines Blocks inkl. alt-Texten und OCR-Text der Bilder (für Lernfilter und Bewertungen). */
  function blockText(block) {
    // Textknoten einzeln mit Leerzeichen verbinden (textContent klebt "Überschrift" und
    // "Absatz" sonst zu einem Wort zusammen).
    const parts = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && SKIP_TAGS.has(n.parentElement.tagName.toUpperCase())
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let total = 0;
    for (let n; (n = walker.nextNode()) && total < 3000;) {
      parts.push(n.nodeValue);
      total += n.nodeValue.length;
    }
    const imgs = [...(block.matches('img, [data-sf-bg]') ? [block] : []), ...block.querySelectorAll('img, [data-sf-bg]')];
    for (const img of imgs) {
      for (const a of ['alt', 'title']) {
        const v = img.getAttribute(a);
        if (v && !isTagList(v)) parts.push(v);
      }
      parts.push(img.__sfOcr || '');
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
  }

  /** Inhalte ohne Schlagwort, die das Modell mit hoher Sicherheit als unerwünscht einstuft. */
  function learnWork(deadline) {
    learnHandle = null;
    if (!learnHandleable()) { learnCandidates.clear(); return; }
    const start = performance.now();
    const budget = () => (deadline.didTimeout ? IDLE_BUDGET_MS - (performance.now() - start) : deadline.timeRemaining());
    for (const el of learnCandidates) {
      learnCandidates.delete(el);
      if (!el.isConnected || el.closest('[data-sf-hit], [data-sf-revealed], .sf-placeholder')) continue;
      const heading = /^H[1-6]$/.test(el.tagName);
      const block = heading ? findBlock(el) : el;
      if (scoredBlocks.has(block) || clearedBlocks.has(block)) continue;
      if (!heading && !blockOk(block)) continue;
      if (trustedPage && inTrustedArea(block)) continue; // bewusst geöffneter Artikel
      scoredBlocks.add(block);
      const text = blockText(block);
      if (text.length >= 25) {
        const s = learningHides() ? L.score(model, text) : null;
        if (s && s.known >= 3 && s.p >= settings.learnThreshold) {
          hit(block, `gelernt, ${Math.round(s.p * 100)} %`, { block, force: true, why: 'gelernt' });
        } else if (semanticOn() && wordCount(text) >= SEM_MIN_WORDS) {
          // Sehr kurze Texte (Bildnachweise, Rubriknamen) liegen beim Modell zufällig nah an allem.
          semQueue.add(block);
        }
      }
      if (budget() <= 1) break;
    }
    if (learnCandidates.size) learnHandle = requestIdle(learnWork);
    flushSem();
    reportCount();
  }

  /* ---------------- KI-Gegenprüfung von Schlagwort-Treffern ---------------- */

  const vetoQueue = new Set();
  let vetoBusy = false;
  let vetoTimer = null;

  /** Antwort des Hintergrunds: Funktion abgeschaltet oder Modell fehlt (nicht: vorübergehender Fehler). */
  function isOffError(error) {
    return error === 'aus' || error === 'Modell nicht installiert';
  }

  function isKeywordReason(kw) {
    return !NO_TONE_REASONS.has(kw) && kw !== 'Bedeutung' && !String(kw).startsWith('gelernt');
  }

  function scheduleVeto() {
    if (!vetoTimer) vetoTimer = setTimeout(() => { vetoTimer = null; flushVeto(); }, 150);
  }

  /** Doppeldeutige Treffer (z. B. „Schüsse“ beim Fußball) wieder aufdecken, wenn klar harmlos. */
  async function flushVeto() {
    if (vetoBusy || !vetoQueue.size || !active || semUnavailable) return;
    const blocks = [];
    for (const b of vetoQueue) {
      vetoQueue.delete(b);
      if (b.isConnected && b.dataset.sfHit && !b.dataset.sfRevealed) blocks.push(b);
      if (blocks.length >= SEM_BATCH) break;
    }
    if (!blocks.length) return;
    vetoBusy = true;
    const gen = generation;
    let res = null;
    try {
      res = await withTimeout(chrome.runtime.sendMessage({ type: 'semScore', texts: blocks.map((b) => blockText(b).slice(0, 600)) }), 120000);
    } catch (_) { /* bleibt unscharf */ }
    vetoBusy = false;
    // Veraltete Antwort (Einstellungen geändert): Warteschlange trotzdem weiter abarbeiten.
    if (gen !== generation || !active) { if (active) flushVeto(); return; }
    if (res && res.ok) {
      res.results.forEach((r, i) => {
        const b = blocks[i];
        if (!b.isConnected || !b.dataset.sfHit) return;
        if (neverToneMatcher().find(blockText(b))) return;
        if (!r.veto) {
          // Knapp nicht harmlos genug: Chromes eingebautes Modell darf noch einmal urteilen.
          if (r.unsure && settings.nanoCheck && !nanoUnavailable) { nanoQueue.add(b); flushNano(); }
          return;
        }
        unhide(b);
        clearedBlocks.add(b);
        b.dataset.sfVeto = String(Math.round((r.good - r.bad) * 1000) / 1000);
      });
      reportCount();
    } else if (res && isOffError(res.error)) {
      semUnavailable = true;
      vetoQueue.clear();
      return;
    }
    if (vetoQueue.size) flushVeto();
  }

  /* ---------------- Zweite Meinung: Chromes eingebautes Modell (Gemini Nano) ---------------- */

  const NANO_BATCH = 4;
  const nanoQueue = new Set();
  let nanoBusy = false;
  let nanoUnavailable = false; // Modell fehlt: auf dieser Seite nicht weiter fragen

  async function flushNano() {
    if (nanoBusy || !nanoQueue.size || !active || nanoUnavailable) return;
    const blocks = [];
    for (const b of nanoQueue) {
      nanoQueue.delete(b);
      if (b.isConnected && b.dataset.sfHit && !b.dataset.sfRevealed) blocks.push(b);
      if (blocks.length >= NANO_BATCH) break;
    }
    if (!blocks.length) return;
    nanoBusy = true;
    const gen = generation;
    let res = null;
    try {
      res = await withTimeout(chrome.runtime.sendMessage({ type: 'nanoJudge', texts: blocks.map((b) => blockText(b).slice(0, 1200)) }), 90000);
    } catch (_) { /* bleibt unscharf */ }
    nanoBusy = false;
    if (gen !== generation || !active) { if (active) flushNano(); return; }
    if (res && res.ok) {
      res.harmless.forEach((harmless, i) => {
        const b = blocks[i];
        if (!harmless || !b.isConnected || !b.dataset.sfHit) return;
        unhide(b);
        clearedBlocks.add(b);
        b.dataset.sfNano = 'harmlos';
      });
      reportCount();
    } else {
      nanoUnavailable = true; // nicht verfügbar oder abgeschaltet
      nanoQueue.clear();
      return;
    }
    if (nanoQueue.size) flushNano();
  }

  /* ---------------- Gute Nachrichten trotz gesperrtem Thema ---------------- */

  // Treffer, die nie wegen guten Tons aufgedeckt werden: selbst gesperrt, Bereich, Bildfehler.
  const NO_TONE_REASONS = new Set(['von dir ausgeblendet', 'Bereich', 'Bild nicht prüfbar']);
  const toneQueue = new Set();
  let toneBusy = false;
  let toneTimer = null;
  let toneUnavailable = false;

  let neverTone = null;
  function neverToneMatcher() {
    if (!neverTone) neverTone = compile(globalThis.SFPresets.termsFor(['tod', 'missbrauch']));
    return neverTone;
  }

  function scheduleTone() {
    if (!toneTimer) toneTimer = setTimeout(() => { toneTimer = null; flushTone(); }, 150);
  }

  async function flushTone() {
    if (toneBusy || !toneQueue.size || !active) return;
    const blocks = [];
    for (const b of toneQueue) {
      toneQueue.delete(b);
      if (b.isConnected && b.dataset.sfHit && !b.dataset.sfRevealed) blocks.push(b);
      if (blocks.length >= SEM_BATCH) break;
    }
    if (!blocks.length) return;
    toneBusy = true;
    const gen = generation;
    let res = null;
    try {
      res = await withTimeout(chrome.runtime.sendMessage({ type: 'toneScore', texts: blocks.map((b) => blockText(b).slice(0, 600)) }), 120000);
    } catch (_) { /* bleibt unscharf */ }
    toneBusy = false;
    // Veraltete Antwort (Einstellungen geändert): Warteschlange trotzdem weiter abarbeiten.
    if (gen !== generation || !active) { if (active) flushTone(); return; }
    if (res && res.ok) {
      res.results.forEach((r, i) => {
        const b = blocks[i];
        if (!r.positive || !b.isConnected || !b.dataset.sfHit) return;
        // Tod/Suizid und Missbrauch: nie aufdecken, auch wenn die Meldung positiv ist.
        if (neverToneMatcher().find(blockText(b))) return;
        // Wer so etwas laut Lernfilter klar nicht sehen will, bekommt es auch positiv nicht.
        const s = learningActive() ? L.score(model, blockText(b)) : null;
        if (s && s.known >= 2 && s.p >= 0.9) return;
        unhide(b);
        clearedBlocks.add(b);
        b.dataset.sfPositive = String(r.diff);
      });
      reportCount();
    } else if (res && isOffError(res.error)) {
      toneUnavailable = true;
      toneQueue.clear();
      return;
    }
    if (toneQueue.size) flushTone();
  }

  /* ---------------- Bedeutungs-Filter (Stufe 2) ---------------- */

  const SEM_BATCH = 24;
  const SEM_MIN_WORDS = 4;

  function wordCount(text) {
    return text.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length;
  }
  const semQueue = new Set();
  let semBusy = false;
  let semUnavailable = false; // Modell fehlt: auf dieser Seite nicht weiter nachfragen

  /** Teaser gesammelt an das lokale Sprachmodell geben (immer nur eine Anfrage gleichzeitig). */
  async function flushSem() {
    if (semBusy || !semQueue.size || !semanticOn() || !active) return;
    const blocks = [];
    for (const b of semQueue) {
      semQueue.delete(b);
      if (!b.isConnected || b.dataset.sfHit || b.dataset.sfRevealed || b.closest('[data-sf-hit]') || clearedBlocks.has(b)) continue;
      blocks.push(b);
      if (blocks.length >= SEM_BATCH) break;
    }
    if (!blocks.length) return;
    semBusy = true;
    const gen = generation;
    let res = null;
    try {
      res = await withTimeout(chrome.runtime.sendMessage({ type: 'semScore', texts: blocks.map((b) => blockText(b).slice(0, 600)) }), 120000);
    } catch (_) { /* Zeitüberschreitung o. Ä.: diese Teaser bleiben sichtbar */ }
    semBusy = false;
    // Veraltete Antwort (Einstellungen geändert): Warteschlange trotzdem weiter abarbeiten.
    if (gen !== generation || !active) { if (active) flushSem(); return; }
    if (res && res.ok) {
      res.results.forEach((r, i) => {
        const b = blocks[i];
        if (r.hide && b.isConnected) hit(b, 'Bedeutung', { block: b, why: 'ki' });
      });
      reportCount();
    } else if (res && isOffError(res.error)) {
      semUnavailable = true;
      semQueue.clear();
      return;
    }
    if (semQueue.size) flushSem();
  }

  function train(block, label) {
    const text = blockText(block);
    if (!text) return;
    try {
      chrome.runtime.sendMessage({ type: 'train', label, text }).catch(() => {});
    } catch (_) { /* Erweiterung neu geladen */ }
  }

  function toast(text, ms) {
    for (const old of document.querySelectorAll('.sf-toast')) old.remove();
    const t = document.createElement('div');
    t.className = 'sf-toast';
    t.textContent = text;
    (document.body || document.documentElement).appendChild(t);
    setTimeout(() => t.remove(), ms || 2600);
  }

  /** Rechtsklickmenü: "Will ich nicht sehen" / "Will ich sehen". */
  function onContextAction(action) {
    const target = lastCtxTarget;
    if (!target || !target.isConnected) return;
    const el = target.nodeType === 1 ? target : target.parentElement;
    if (!el) return;
    if (action === 'zone') { startZonePicker(el); return; }
    if (action === 'why') { whyAt(el); return; }
    const ph = el.closest('.sf-placeholder');
    const hidden = ph ? ph.__sfBlock : el.closest('[data-sf-hit]');
    if (action === 'block') {
      if (hidden) {
        train(hidden, 'b');
        suggestBar(hidden);
        return;
      }
      const fb = el.closest('.sf-feedback');
      const block = findBlock((fb && fb.__sfBlock) || el); // Auswahlleiste hat keinen Block
      if (!block || block === document.body || block === document.documentElement) {
        toast('Hier wurde kein einzelner Inhaltsblock erkannt.');
        return;
      }
      train(block, 'b');
      if (active) {
        delete block.dataset.sfRevealed;
        clearedBlocks.delete(block);
        hit(block, 'von dir ausgeblendet', { block, force: true, why: 'du' });
      }
      suggestBar(block);
    } else if (action === 'ok') {
      if (hidden) {
        train(hidden, 'o');
        reveal(hidden, ph, { feedback: false });
      } else {
        const block = findBlock(el);
        train(block, 'o');
        clearedBlocks.add(block);
      }
      toast('Gemerkt: will ich sehen');
    }
  }

  /**
   * Markante Begriffe eines Blocks als Schlagwort-Vorschläge: längere Wörter, bevorzugt
   * großgeschrieben (Hauptwörter), häufig, und solche, die das Lernmodell schon mit
   * "ausblenden" verbindet. Füllwörter und bereits bekannte Schlagwörter fallen weg.
   */
  function suggestTerms(block, max) {
    const text = blockText(block);
    const words = text.match(/[\p{L}][\p{L}\p{N}]{4,}/gu) || [];
    const stats = new Map();
    for (const w of words) {
      const n = globalThis.SFMatch.normalize(w);
      if (!n || L.STOPWORDS.has(n) || n.length < 5) continue;
      const cur = stats.get(n) || { word: w, count: 0, cap: false };
      cur.count++;
      if (/^\p{Lu}/u.test(w) && !cur.cap) { cur.cap = true; cur.word = w; }
      stats.set(n, cur);
    }
    const out = [];
    for (const [n, st] of stats) {
      if (matcher && matcher.find(st.word)) continue; // schon abgedeckt
      const f = model && model.f && model.f[n];
      const learned = f && model.docs.b && model.docs.o
        ? Math.log((f[0] + 1) / (model.docs.b + 2)) - Math.log((f[1] + 1) / (model.docs.o + 2)) : 0;
      const score = st.count * 1.5 + (st.cap ? 2 : 0) + Math.min(st.word.length, 14) / 7 + Math.max(0, learned);
      out.push({ word: st.word, score });
    }
    out.sort((a, b) => b.score - a.score);
    // Hauptwörter (großgeschrieben) bevorzugen; kleingeschriebene nur, wenn sonst zu wenig da ist.
    const caps = out.filter((x) => /^\p{Lu}/u.test(x.word));
    const list = caps.length >= 3 ? caps : out;
    return list.slice(0, max).map((x) => x.word);
  }

  /** Nach "Will ich nicht sehen": Begriffe aus dem Artikel als Schlagwörter anbieten. */
  function suggestBar(block) {
    const terms = suggestTerms(block, 8);
    if (!terms.length) { toast('Gemerkt: will ich nicht sehen'); return; }
    const bar = overlayBar(block);
    bar.classList.add('sf-suggest');
    const label = document.createElement('span');
    label.textContent = 'Gemerkt. Auch als Schlagwort künftig unscharf stellen:';
    const chips = document.createElement('span');
    chips.className = 'sf-chips';
    const chosen = new Set();
    for (const t of terms) {
      const chip = button(t, () => {
        if (chosen.has(t)) { chosen.delete(t); chip.classList.remove('sf-on'); }
        else { chosen.add(t); chip.classList.add('sf-on'); }
        chip.setAttribute('aria-pressed', String(chosen.has(t)));
        add.disabled = !chosen.size;
      });
      chip.classList.add('sf-chip');
      chip.setAttribute('aria-pressed', 'false');
      chips.append(chip);
    }
    const add = button('Hinzufügen', async () => {
      const list = [...chosen];
      if (!list.length) return;
      closeBar(block);
      const s = await S.load();
      const have = new Set(s.keywords.map((k) => k.toLowerCase()));
      const fresh = list.filter((t) => !have.has(t.toLowerCase()));
      await S.save({ keywords: s.keywords.concat(fresh) });
      toast(fresh.length === 1 ? `„${fresh[0]}“ ist jetzt ein Schlagwort` : `${fresh.length} Schlagwörter hinzugefügt`);
    });
    add.classList.add('sf-primary');
    add.disabled = true;
    const close = button('×', () => closeBar(block));
    close.title = 'Schließen';
    bar.append(label, chips, add, close);
    setTimeout(() => { if (block.__sfBar === bar && !chosen.size) closeBar(block); }, 30000);
  }

  /** Nach dem Aufdecken kurz nachfragen, ob das Ausblenden richtig war. */
  function showFeedback(block, kw) {
    if (!block.parentNode) return;
    const bar = document.createElement('div');
    bar.className = 'sf-feedback';
    bar.__sfBlock = block;
    const label = document.createElement('span');
    label.textContent = 'War das Ausblenden richtig?';
    const yes = button('Ja, ausblenden', () => {
      train(block, 'b');
      bar.remove();
      delete block.dataset.sfRevealed;
      for (const img of block.querySelectorAll('img')) delete img.dataset.sfRevealed;
      hit(block, kw, { block, force: true, noTone: true });
    });
    const no = button('Nein, will ich sehen', () => {
      train(block, 'o');
      clearedBlocks.add(block);
      bar.textContent = 'Gemerkt.';
      setTimeout(() => bar.remove(), 1200);
    });
    bar.append(label, yes, no);
    block.parentNode.insertBefore(bar, block);
    setTimeout(() => bar.remove(), 20000);
  }

  /**
   * Knopf zum Aufdecken. Mit der Option „Aufdecken nur durch Gedrückthalten“ muss er
   * HOLD_MS lang gedrückt werden (Maus, Touch oder Enter/Leertaste); ein kurzer Klick zeigt
   * nur einen Hinweis.
   */
  function revealButton(text, onReveal) {
    if (!settings.revealHold) return button(text, onReveal);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sf-btn sf-hold';
    b.title = 'Gedrückt halten zum Anzeigen';
    // Ladekreis: grauer Ring, der sich beim Gedrückthalten blau füllt.
    const ring = ringSvg();
    const label = document.createElement('span');
    label.textContent = text;
    b.append(ring, label);
    let timer = null;
    let done = false;
    const start = (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return; // Rechtsklick: Menü, nicht aufdecken
      ev.preventDefault();
      ev.stopPropagation();
      if (timer || done) return;
      b.classList.add('sf-holding');
      timer = setTimeout(() => {
        timer = null;
        done = true;
        b.classList.remove('sf-holding');
        onReveal();
      }, HOLD_MS);
    };
    const cancel = (ev) => {
      if (ev) ev.stopPropagation();
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      b.classList.remove('sf-holding');
    };
    b.addEventListener('pointerdown', start);
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(t, cancel);
    b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start(e); });
    b.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') cancel(e); });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!done) toast('Zum Anzeigen gedrückt halten');
    });
    return b;
  }

  function button(text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sf-btn';
    b.textContent = text;
    b.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); onClick(); });
    return b;
  }

  /* ---------------- „Warum unscharf?“ ---------------- */

  let presetMatchers = null;

  /** Aus welcher Liste stammt ein Schlagwort? (Name der Vorschlagsliste oder „deine Liste“) */
  function listOf(kw) {
    const P = globalThis.SFPresets;
    if (compile(settings.keywords).find(kw)) return 'deiner eigenen Schlagwortliste';
    if (!presetMatchers) presetMatchers = P.PRESETS.map((p) => [p, compile(p.terms)]);
    const hitP = presetMatchers.find(([p, m]) => settings.presets.includes(p.id) && m.find(kw));
    return hitP ? `der Liste „${hitP[0].name}“` : 'einer Liste';
  }

  function explain(block) {
    // Nach dem Aufdecken sind die Markierungen weg; dann den gemerkten Grund nehmen.
    const last = block.__sfLast || {};
    const kw = block.dataset.sfHit || last.kw || '';
    switch (block.dataset.sfWhy || last.why) {
      case 'text': return `Schlagwort „${kw}“ aus ${listOf(kw)} im Text.`;
      case 'bildtext': return `Schlagwort „${kw}“ aus ${listOf(kw)} in der Bildbeschreibung.`;
      case 'ocr': return `Schlagwort „${kw}“ aus ${listOf(kw)} als Schrift im Bild.`;
      case 'ki': return 'Die KI hält den Inhalt für inhaltlich nah an einem gesperrten Thema oder an Inhalten, die du ausgeblendet hast.';
      case 'gelernt': return `Gelernt aus deinen Bewertungen (${kw.replace('gelernt, ', '')} sicher).`;
      case 'du': return 'Von dir mit 👎 ausgeblendet.';
      case 'bereich': return 'Gesperrter Bereich dieser Seite.';
      case 'fehler': return 'Das Bild konnte nicht geprüft werden (Einstellung: bei Fehlern ausblenden).';
      default: return kw ? `Treffer: „${kw}“.` : 'Unbekannter Grund.';
    }
  }

  function whyButton(block, bar) {
    const b = button('ⓘ', () => {
      const info = document.createElement('div');
      info.className = 'sf-why';
      info.textContent = explain(block);
      b.replaceWith(info);
    });
    b.title = 'Warum war das unscharf?';
    b.setAttribute('aria-label', b.title);
    return b;
  }

  /** Rechtsklick → „Warum unscharf?“ */
  function whyAt(el) {
    const ph = el.closest('.sf-placeholder');
    const block = ph ? ph.__sfBlock : el.closest('[data-sf-hit]');
    if (block) { toast(explain(block), 6000); return; }
    const img = el.tagName === 'IMG' ? el : el.querySelector && el.querySelector('img[data-sf]');
    const st = img && img.dataset.sf;
    if (st === 'pending' || st === 'wait') toast('Dieses Bild wird noch auf Schrift geprüft. Gedrückt halten zeigt es sofort.', 6000);
    else if (st === 'err') toast('Dieses Bild konnte nicht geprüft werden und bleibt laut Einstellung unscharf.', 6000);
    else if (el.closest('[data-sf-veto]')) toast('Ein Schlagwort traf, aber die KI hält den Inhalt für harmlos – daher sichtbar.', 6000);
    else if (el.closest('[data-sf-positive]')) toast('Gesperrtes Thema, aber eine gute Nachricht – daher sichtbar.', 6000);
    else toast('Hier ist nichts unscharf.', 3000);
  }

  /* ---------------- Gesperrte Bereiche (Rubriken) ---------------- */

  function firstHeading(el) {
    const h = el.querySelector('h1, h2, h3, h4, h5, h6');
    return h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  }

  /** Wendet die Bereichsregeln dieser Seite an (auch auf nachgeladene Inhalte). */
  function applyZones() {
    if (!active) return;
    for (const z of zoneRules) {
      let els;
      try { els = document.querySelectorAll(z.sel); } catch (_) { continue; }
      for (const el of els) {
        if (el.dataset.sfHit || el.dataset.sfRevealed || el.closest('[data-sf-hit]')) continue;
        if (z.head && firstHeading(el) !== z.head) continue;
        el.__sfZone = z;
        hit(el, 'Bereich', { block: el, force: true, why: 'bereich' });
      }
    }
  }

  async function removeZone(z) {
    const s = await S.load();
    await S.save({ zones: s.zones.filter((x) => !(x.host === z.host && x.sel === z.sel && x.head === z.head)) });
    toast('Bereich wird nicht mehr gesperrt');
  }



  function countTeasers(el) {
    return Math.max(el.querySelectorAll('h1, h2, h3, h4, h5, h6').length, el.querySelectorAll('article, li').length);
  }

  /** Vorschlag für den Bereich: nächster Vorfahre des Beitrags, der mehrere Beiträge enthält. */
  function zoneCandidate(el) {
    const start = findBlock(el);
    for (let cur = start.parentElement; cur && cur !== document.body && cur !== document.documentElement; cur = cur.parentElement) {
      if (cur.tagName === 'MAIN') break;
      if (countTeasers(cur) >= 2) return cur;
    }
    return start;
  }

  function descriptor(e) {
    if (e.id && /^[A-Za-z][\w-]{1,60}$/.test(e.id) && !/\d{3,}/.test(e.id)) return '#' + CSS.escape(e.id);
    const cls = [...e.classList]
      .filter((c) => !c.startsWith('sf-') && c.length < 40 && !/\d{2,}/.test(c) && !/^(is|has|js)-/.test(c))
      .slice(0, 3);
    return e.tagName.toLowerCase() + cls.map((c) => '.' + CSS.escape(c)).join('');
  }

  /** Möglichst stabiler CSS-Selektor: id oder Tag+Klassen, bei Bedarf mit Eltern-Elementen. */
  function selectorFor(el) {
    const parts = [descriptor(el)];
    let cur = el;
    for (let i = 0; i < 4 && !/[#.]/.test(parts[0]); i++) {
      cur = cur.parentElement;
      if (!cur || cur === document.body || cur === document.documentElement) break;
      parts.unshift(descriptor(cur));
    }
    return parts.join(' > ');
  }

  function makeZoneRule(el) {
    const sel = selectorFor(el);
    let count = 0;
    try { count = document.querySelectorAll(sel).length; } catch (_) { /* ungültig */ }
    // Überschrift nur speichern, wenn der Selektor mehrere Bereiche trifft (z. B. alle Rubriken).
    const title = firstHeading(el);
    const head = count > 1 ? title : '';
    // label dient nur der Anzeige in den Einstellungen.
    return { host: S.normalizeHost(location.hostname), sel, head, label: title };
  }

  /** Auswahl wie bei Adblock: Bereich markieren, mit Größer/Kleiner anpassen, speichern. */
  function startZonePicker(target) {
    document.querySelectorAll('.sf-picker').forEach((b) => b.remove());
    document.querySelectorAll('.sf-pick').forEach((e) => e.classList.remove('sf-pick'));
    let el = zoneCandidate(target);
    const smaller = [];
    const bar = document.createElement('div');
    bar.className = 'sf-feedback sf-picker';
    const label = document.createElement('span');
    const update = () => {
      document.querySelectorAll('.sf-pick').forEach((e) => e.classList.remove('sf-pick'));
      el.classList.add('sf-pick');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const head = firstHeading(el);
      label.textContent = `Diesen Bereich auf ${location.hostname} immer sperren?` + (head ? ` – „${head}“` : '');
    };
    const cleanup = () => {
      el.classList.remove('sf-pick');
      bar.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') cleanup(); };
    const bigger = button('Größer', () => {
      const p = el.parentElement;
      if (!p || p === document.body || p === document.documentElement) { toast('Größer geht nicht'); return; }
      smaller.push(el);
      el = p;
      update();
    });
    const less = button('Kleiner', () => {
      if (smaller.length) el = smaller.pop();
      else {
        const child = [...el.children].find((c) => c.contains(target));
        if (!child) { toast('Kleiner geht nicht'); return; }
        el = child;
      }
      update();
    });
    const save = button('Sperren', async () => {
      const rule = makeZoneRule(el);
      cleanup();
      const s = await S.load();
      if (!s.zones.some((z) => z.host === rule.host && z.sel === rule.sel && z.head === rule.head)) {
        await S.save({ zones: s.zones.concat(rule) });
      }
      toast('Bereich wird ab jetzt unscharf gestellt');
    });
    save.classList.add('sf-primary');
    const cancel = button('Abbrechen', cleanup);
    bar.append(label, bigger, less, save, cancel);
    (document.body || document.documentElement).appendChild(bar);
    document.addEventListener('keydown', onKey, true);
    update();
  }

  /* ---------------- Ausblenden ---------------- */

  /** Liefert true, wenn der Block jetzt ausgeblendet ist. */
  function hit(el, kw, opts) {
    opts = opts || {};
    const block = opts.block || findBlock(el);
    if (!block || !block.dataset) return false;
    // Nie die ganze Seite: Text direkt unter <body> o. Ä.
    if (block === document.body || block === document.documentElement || block.tagName === 'MAIN') return false;
    if (!opts.force && clearedBlocks.has(block)) return false;
    if (block.dataset.sfHit || block.dataset.sfRevealed || block.closest('[data-sf-hit]')) return false;
    // Bewusst geöffneter Artikel: automatische Treffer im Artikeltext nicht ausblenden.
    if (AUTO_WHY.has(opts.why) && inTrustedArea(block)) return false;
    // Knöpfe, Menüs, Kopf- und Fußleiste der Seite: keine Inhalte.
    if (AUTO_WHY.has(opts.why) && isPageChrome(el, block)) return false;
    // Lernfilter: Schlagwort trifft, aber laut Bewertungen will der Nutzer das sehen.
    if (!opts.force && learningActive()) {
      const s = L.score(model, blockText(block));
      if (s && s.known >= LEARN_KEEP_KNOWN && s.p < LEARN_KEEP) {
        clearedBlocks.add(block);
        block.dataset.sfLearnOk = String(Math.round(s.p * 100));
        return false;
      }
    }
    block.dataset.sfHit = kw;
    if (opts.why) block.dataset.sfWhy = opts.why;
    // Schlagwort-Treffer mit dem Sprachmodell gegenprüfen (bleibt bis dahin unscharf).
    if (settings.semantic && settings.semanticVeto && !semUnavailable && !opts.noTone && isKeywordReason(kw)) {
      vetoQueue.add(block);
      scheduleVeto();
    }
    // Gute Nachrichten trotz Thema: Ton nachträglich prüfen (bleibt bis dahin unscharf).
    if (settings.positiveShow && !toneUnavailable && !opts.noTone && !NO_TONE_REASONS.has(kw)) {
      toneQueue.add(block);
      scheduleTone();
    }
    // Bereits markierte Treffer im Inneren zählen nicht doppelt.
    for (const inner of hitBlocks) if (block.contains(inner)) unhide(inner);
    hitBlocks.add(block);

    if (settings.display === 'hide') {
      block.classList.add('sf-hidden');
    } else if (settings.display === 'blur') {
      // Nur unscharf, ohne Hinweis auf das Schlagwort und ohne Knöpfe.
      // Gedrückt halten (Ladekreis) zeigt den Inhalt, danach 👍/👎.
      block.classList.add('sf-blurred');
      block.addEventListener('pointerdown', onBlurDown, true);
      block.addEventListener('click', onBlurClick, true);
    } else {
      const ph = document.createElement(block.tagName === 'LI' ? 'li' : 'div');
      ph.className = 'sf-placeholder';
      ph.__sfBlock = block;
      const label = document.createElement('span');
      label.className = 'sf-ph-text';
      label.setAttribute('role', 'button');
      label.tabIndex = 0;
      label.title = 'Klicken zum Anzeigen';
      label.textContent = block.__sfZone ? 'Gesperrter Bereich' : 'Ausgeblendet';
      const actions = document.createElement('span');
      actions.className = 'sf-ph-actions';
      const keep = button('Passt so', () => {
        train(block, 'b');
        actions.textContent = '✓ gemerkt';
      });
      keep.title = 'Richtig ausgeblendet – merken';
      const want = revealButton('Will ich sehen', () => {
        train(block, 'o');
        reveal(block, ph, { feedback: false });
        toast('Gemerkt: will ich sehen');
      });
      want.title = 'Falsch ausgeblendet – anzeigen und merken';
      const show = revealButton('Anzeigen', () => reveal(block, ph, { feedback: !block.__sfZone }));
      if (block.__sfZone) {
        actions.append(show, button('Bereich nicht mehr sperren', () => removeZone(block.__sfZone)));
      } else {
        actions.append(show, keep, want);
      }
      ph.append(label, actions);
      const phReveal = () => {
        if (settings.revealHold) { toast('Zum Anzeigen „Anzeigen“ gedrückt halten'); return; }
        reveal(block, ph, { feedback: !block.__sfZone });
      };
      ph.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); phReveal(); });
      label.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); phReveal(); } });
      block.classList.add('sf-hidden-ph');
      block.parentNode && block.parentNode.insertBefore(ph, block);
      block.__sfPlaceholder = ph;
    }
    scheduleReport();
    return true;
  }

  function unhide(block) {
    if (block.__sfBar && !block.__sfBar.contains(document.activeElement)) closeBar(block);
    block.classList.remove('sf-hidden', 'sf-blurred', 'sf-hidden-ph');
    block.removeEventListener('click', onBlurClick, true);
    block.removeEventListener('pointerdown', onBlurDown, true);
    cancelHold();
    if (block.__sfPlaceholder) { block.__sfPlaceholder.remove(); block.__sfPlaceholder = null; }
    delete block.dataset.sfHit;
    delete block.dataset.sfWhy;
    hitBlocks.delete(block);
    // Bilder im Block wurden übersprungen, solange er ausgeblendet war: jetzt prüfen
    // (nach dem Aufrufer, der den Block meist noch als geprüft markiert).
    queueMicrotask(() => {
      if (!active || !block.isConnected || block.dataset.sfHit) return;
      const imgs = block.tagName === 'IMG' ? [block] : block.querySelectorAll('img');
      for (const img of imgs) if (img.dataset.sf !== 'ok' && img.dataset.sf !== 'small') processImage(img);
    });
  }

  /**
   * Unscharfer Block: Drücken startet sofort den Ladekreis in der Blockmitte; wer gedrückt hält,
   * bis er voll ist, sieht den Inhalt. Loslassen, Wegziehen oder Scrollen bricht ab. Ohne die
   * Option „Gedrückthalten“ genügt ein Klick. Klicks auf Links im unscharfen Block werden
   * abgefangen.
   */
  let hold = null; // { block, ring, timer, x, y }

  function onBlurDown(ev) {
    if (ev.button !== 0) return; // Rechtsklick bleibt fürs Menü
    const block = ev.currentTarget;
    ev.preventDefault();
    ev.stopPropagation();
    beginHold(ev, () => revealBlurred(block), block);
  }

  /** Bilder, die noch geprüft werden, lassen sich ebenso per Gedrückthalten aufdecken. */
  function pendingImageAt(target) {
    const img = target && target.tagName === 'IMG' ? target : null;
    return img && ['wait', 'pending', 'err'].includes(img.dataset.sf) && !img.dataset.sfRevealed &&
      !img.closest('[data-sf-hit]') ? img : null;
  }

  function onPendingDown(ev) {
    if (!active || ev.button !== 0) return;
    const img = pendingImageAt(ev.target);
    if (!img) return;
    ev.preventDefault();
    ev.stopPropagation();
    beginHold(ev, () => {
      swallowNextClick();
      img.dataset.sfRevealed = '1';
    }, img);
  }

  function onPendingClick(ev) {
    // Kurzer Klick auf ein noch unscharfes Bild öffnet keinen Link dahinter.
    if (active && pendingImageAt(ev.target)) { ev.preventDefault(); ev.stopPropagation(); }
  }

  /** Mitte des sichtbaren Teils eines Elements (lange Artikel ragen oft aus dem Fenster). */
  function visibleCenter(el) {
    const r = el.getBoundingClientRect();
    const left = Math.max(r.left, 0), right = Math.min(r.right, window.innerWidth);
    const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, window.innerHeight);
    if (right <= left || bottom <= top) return null;
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }

  function beginHold(ev, onDone, el) {
    if (!settings.revealHold) { onDone(); return; }
    cancelHold();
    // Ladekreis in der Mitte des Bildes bzw. Textblocks, nicht unter dem Mauszeiger.
    const c = (el && visibleCenter(el)) || { x: ev.clientX, y: ev.clientY };
    const ring = holdRing(c.x, c.y);
    hold = { ring, x: ev.clientX, y: ev.clientY, timer: setTimeout(() => {
      cancelHold();
      onDone();
    }, HOLD_MS) };
    window.addEventListener('pointerup', onHoldEnd, true);
    window.addEventListener('pointercancel', onHoldCancel, true);
    window.addEventListener('pointermove', onHoldMove, true);
    window.addEventListener('blur', onHoldCancel, true);
  }

  function onHoldCancel(ev) {
    // Scrollen per Touch oder Fensterwechsel: ohne Hinweis abbrechen. Fokuswechsel innerhalb
    // der Seite (blur einzelner Elemente, im Capture-Modus ebenfalls hier) zählen nicht.
    if (ev && ev.type === 'blur' && ev.target !== window) return;
    onHoldEnd(null, true);
  }

  function onHoldMove(ev) {
    if (hold && Math.hypot(ev.clientX - hold.x, ev.clientY - hold.y) > 24) onHoldEnd(ev, true);
  }

  function onHoldEnd(_ev, moved) {
    if (!hold) return;
    cancelHold();
    if (!moved) toast('Zum Anzeigen gedrückt halten, bis der Kreis voll ist');
  }

  function cancelHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold.ring.remove();
    hold = null;
    window.removeEventListener('pointerup', onHoldEnd, true);
    window.removeEventListener('pointercancel', onHoldCancel, true);
    window.removeEventListener('pointermove', onHoldMove, true);
    window.removeEventListener('blur', onHoldCancel, true);
  }

  /** Ladekreis an der angegebenen Stelle (fixiert, fängt keine Mausereignisse ab). */
  function holdRing(x, y) {
    const wrap = document.createElement('div');
    wrap.className = 'sf-holdring sf-holding';
    wrap.style.setProperty('left', `${x}px`, 'important');
    wrap.style.setProperty('top', `${y}px`, 'important');
    wrap.append(ringSvg());
    (document.body || document.documentElement).appendChild(wrap);
    return wrap;
  }

  function ringSvg() {
    const NS = 'http://www.w3.org/2000/svg';
    const ring = document.createElementNS(NS, 'svg');
    ring.setAttribute('viewBox', '0 0 20 20');
    ring.setAttribute('class', 'sf-ring');
    ring.setAttribute('aria-hidden', 'true');
    for (const cls of ['sf-ring-bg', 'sf-ring-fg']) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', '10');
      c.setAttribute('cy', '10');
      c.setAttribute('r', '8');
      c.setAttribute('class', cls);
      ring.append(c);
    }
    ring.lastChild.style.animationDuration = HOLD_MS + 'ms';
    return ring;
  }

  function onBlurClick(ev) {
    // Klicks (z. B. auf Links) im unscharfen Block nicht durchlassen; Aufdecken läuft über pointerdown.
    ev.preventDefault();
    ev.stopPropagation();
  }

  /**
   * Nach dem Aufdecken kommt beim Loslassen noch ein Klick – der darf keinen Link hinter dem
   * Bild/Text öffnen. Deshalb wird genau dieser eine Klick abgefangen (bis zur nächsten
   * neuen Berührung bzw. höchstens 5 s lang).
   */
  function swallowNextClick() {
    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      done();
    };
    const fresh = () => setTimeout(done, 0); // neue Berührung: deren Klick normal durchlassen
    const done = () => {
      window.removeEventListener('click', stop, true);
      window.removeEventListener('auxclick', stop, true);
      window.removeEventListener('pointerdown', fresh, true);
      clearTimeout(timer);
    };
    const timer = setTimeout(done, 5000);
    window.addEventListener('click', stop, true);
    window.addEventListener('auxclick', stop, true);
    // Erst nach dem aktuellen Ereignis lauschen, sonst zählt die laufende Berührung als „neu“.
    setTimeout(() => window.addEventListener('pointerdown', fresh, true), 0);
  }

  function revealBlurred(block) {
    swallowNextClick();
    const kw = block.dataset.sfHit;
    const zone = block.__sfZone;
    reveal(block, null, { feedback: false });
    if (zone) askZoneAfterReveal(block, zone);
    else askAfterReveal(block, kw);
  }

  function closeBar(block) {
    if (block.__sfBar) block.__sfBar.remove();
    block.__sfBar = null;
  }

  /** Schwebende Leiste oben auf dem Block, damit das Seitenlayout (Grids usw.) unverändert bleibt. */
  function overlayBar(block) {
    closeBar(block);
    const bar = document.createElement('div');
    bar.className = 'sf-feedback sf-overlay';
    bar.__sfBlock = block;
    block.__sfBar = bar;
    let r = block.getBoundingClientRect();
    if (!r.width && !r.height && block.__sfPlaceholder) r = block.__sfPlaceholder.getBoundingClientRect();
    bar.style.setProperty('left', `${Math.max(0, r.left + window.scrollX)}px`, 'important');
    bar.style.setProperty('max-width', `${Math.max(220, r.width)}px`, 'important');
    bar.style.setProperty('top', '0px', 'important');
    (document.body || document.documentElement).appendChild(bar);
    // Über den Block setzen, damit nichts verdeckt wird; ohne Platz oben darunter.
    const h = bar.offsetHeight || 36;
    const top = r.top >= h + 6 ? r.top - h - 4 : r.bottom + 4;
    bar.style.setProperty('top', `${Math.max(0, top + window.scrollY)}px`, 'important');
    // Klick außerhalb schließt die Leiste – aber erst ein Klick, der nach dem Erscheinen begonnen
    // hat (sonst schlösse das Loslassen nach dem Gedrückthalten die Leiste sofort wieder).
    let armed = false;
    const arm = () => { armed = true; };
    const outside = (e) => {
      if (!bar.isConnected) {
        document.removeEventListener('click', outside, true);
        document.removeEventListener('pointerdown', arm, true);
        return;
      }
      if (!armed || bar.contains(e.target) || block.contains(e.target)) return;
      document.removeEventListener('click', outside, true);
      document.removeEventListener('pointerdown', arm, true);
      closeBar(block);
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', arm, true);
      document.addEventListener('click', outside, true);
    }, 0);
    return bar;
  }

  /** Nach dem Anzeigen: 👍 künftig zeigen, 👎 künftig ausblenden (ohne Antwort: nichts lernen). */
  function askAfterReveal(block, kw) {
    const bar = overlayBar(block);
    bar.classList.add('sf-thumbs');
    const label = document.createElement('span');
    label.textContent = 'Künftig anzeigen?';
    const up = button('👍', () => {
      train(block, 'o');
      clearedBlocks.add(block);
      bar.textContent = 'Gemerkt: wird künftig gezeigt.';
      setTimeout(() => closeBar(block), 1300);
    });
    up.title = 'Ja – so etwas künftig anzeigen';
    up.setAttribute('aria-label', up.title);
    const down = button('👎', () => {
      train(block, 'b');
      closeBar(block);
      delete block.dataset.sfRevealed;
      for (const img of block.querySelectorAll('img')) delete img.dataset.sfRevealed;
      hit(block, kw, { block, force: true, noTone: true });
      toast('Gemerkt: wird künftig ausgeblendet');
    });
    down.title = 'Nein – so etwas künftig ausblenden';
    down.setAttribute('aria-label', down.title);
    const close = button('×', () => closeBar(block));
    close.title = 'Schließen, ohne zu bewerten';
    bar.append(label, up, down, whyButton(block, bar), close);
    setTimeout(() => { if (block.__sfBar === bar) closeBar(block); }, 30000);
  }

  /** Gesperrter Bereich angezeigt: Sperre behalten oder aufheben. */
  function askZoneAfterReveal(block, zone) {
    const bar = overlayBar(block);
    bar.classList.add('sf-thumbs');
    const label = document.createElement('span');
    label.textContent = 'Bereich künftig anzeigen?';
    const up = button('👍', () => { closeBar(block); removeZone(zone); });
    up.title = 'Ja – Bereich nicht mehr sperren';
    up.setAttribute('aria-label', up.title);
    const down = button('👎', () => {
      closeBar(block);
      delete block.dataset.sfRevealed;
      block.__sfZone = zone;
      hit(block, 'Bereich', { block, force: true });
    });
    down.title = 'Nein – Bereich weiter sperren';
    down.setAttribute('aria-label', down.title);
    const close = button('×', () => closeBar(block));
    close.title = 'Schließen';
    bar.append(label, up, down, close);
    setTimeout(() => { if (block.__sfBar === bar) closeBar(block); }, 30000);
  }

  function reveal(block, ph, opts) {
    const kw = block.dataset.sfHit;
    block.__sfLast = { kw, why: block.dataset.sfWhy };
    unhide(block);
    if (ph) ph.remove();
    block.dataset.sfRevealed = '1';
    for (const img of block.querySelectorAll('img')) img.dataset.sfRevealed = '1';
    if (block.tagName === 'IMG') block.dataset.sfRevealed = '1';
    if (kw && !(opts && opts.feedback === false)) showFeedback(block, kw);
    scheduleReport();
  }

  /* ---------------- Zähler ---------------- */

  let reportTimer = null;
  let lastReported = -1;

  function scheduleReport() {
    if (!reportTimer) reportTimer = setTimeout(reportCount, 300);
  }

  function reportCount() {
    clearTimeout(reportTimer);
    reportTimer = null;
    // Von der Seite entfernte Blöcke (Endlos-Feeds) nicht mehr zählen und nicht festhalten.
    for (const b of hitBlocks) if (!b.isConnected) hitBlocks.delete(b);
    const n = hitBlocks.size;
    if (n === lastReported) return;
    lastReported = n;
    try {
      chrome.runtime.sendMessage({ type: 'count', n }).catch(() => {});
    } catch (_) { /* Erweiterung neu geladen */ }
  }

  init();
})();
