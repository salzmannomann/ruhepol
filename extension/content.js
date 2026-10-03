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
  const OCR_MARGIN = '600px';
  const LEARN_KEEP = 0.2; // Schlagwort-Treffer zeigen, wenn das Modell sicher "will ich sehen" sagt
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
  let scoredBlocks = new WeakSet(); // vom Lernfilter schon bewertet
  const learnCandidates = new Set();
  let learnHandle = null;
  let lastCtxTarget = null;
  const shadowRoots = new Set(); // beobachtete offene Shadow-Roots
  const bgQueue = new Set(); // Elemente, deren Hintergrundbild noch geprüft wird
  let bgHandle = null;
  let shadowSheet = null;
  let zoneRules = []; // Bereichsregeln für diese Seite

  /* ---------------- Start / Einstellungen ---------------- */

  async function init() {
    const [s, local] = await Promise.all([S.load(), chrome.storage.local.get('model')]);
    settings = s;
    model = local.model || null;
    apply();
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
    matcher = compile(keywords, { partial: settings.partial, fuzzy: settings.fuzzy, allow: settings.allow });
    clearedBlocks = new WeakSet();
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
    bgQueue.clear();
    if (bgHandle) cancelIdle(bgHandle);
    bgHandle = null;
    if (idleHandle) cancelIdle(idleHandle);
    if (learnHandle) cancelIdle(learnHandle);
    idleHandle = learnHandle = null;
    document.removeEventListener('load', onLoadCapture, true);
    document.removeEventListener('error', onErrorCapture, true);
    document.documentElement.classList.remove('sf-active');
    for (const el of document.querySelectorAll('.sf-placeholder, .sf-feedback')) el.remove();
    for (const el of document.querySelectorAll('[data-sf-hit]')) {
      el.classList.remove('sf-hidden', 'sf-blurred', 'sf-hidden-ph');
      delete el.dataset.sfHit;
    }
    for (const el of document.querySelectorAll('img[data-sf], [data-sf-bg]')) {
      delete el.dataset.sf;
      delete el.dataset.sfBg;
      delete el.dataset.sfSrc;
    }
    for (const root of shadowRoots) {
      for (const el of root.querySelectorAll('.sf-placeholder')) el.remove();
      for (const el of root.querySelectorAll('[data-sf-hit]')) {
        el.classList.remove('sf-hidden', 'sf-blurred', 'sf-hidden-ph');
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
    else { flushOcr(); scheduleLearn(); }
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
          if (!isOwn(el)) checkBackground(el);
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
    if (!pendingRoots.size) { flushOcr(); scheduleLearn(); }
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
    if (kw) hit(el, kw);
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
      if (v) {
        const kw = matcher.find(v);
        if (kw) { hit(el, kw); return; }
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
    if (img.closest('[data-sf-hit], [data-sf-revealed]')) return;
    // Vorauswahl: Bildhinweise (alt, title, aria-label, figcaption) sofort prüfen, noch bevor
    // das Bild geladen ist. Bei Treffer wird der Block gleich ausgeblendet; OCR entfällt dann,
    // und ausgeblendete Lazy-Bilder werden oft gar nicht erst geladen.
    const kw = matcher.find(imageContextText(img));
    if (kw) { hitImage(img, kw); return; }

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
    if (kw) { hitImage(el, kw); return; }
    el.dataset.sfBg = 'pending';
    if (!settings.ocr) { el.dataset.sfBg = 'ok'; return; }
    if (io) io.observe(el);
  }

  function imageContextText(img) {
    const parts = [img.getAttribute('alt'), img.getAttribute('title'), img.getAttribute('aria-label')];
    const fig = img.closest('figure');
    if (fig) {
      const cap = fig.querySelector('figcaption');
      if (cap) parts.push(cap.textContent);
    }
    return parts.filter(Boolean).join(' \n ');
  }

  const ocrWaiting = new Set();

  function onIntersect(entries) {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      ocrWaiting.add(e.target);
    }
    flushOcr();
  }

  /**
   * OCR erst starten, wenn der Textscan durch ist: Steht das Schlagwort schon im Teaser-Text,
   * ist der Block bereits ausgeblendet und das Bild muss nicht gelesen werden.
   */
  function flushOcr() {
    if (pendingRoots.size || activeWalker || mutationTimer) return; // work()/flushMutations() rufen erneut auf
    for (const img of ocrWaiting) {
      ocrWaiting.delete(img);
      if (!img.isConnected || img.closest('[data-sf-hit], [data-sf-revealed]')) continue;
      runOcr(img);
    }
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
      res = { ok: false, error: String(e) };
    }
    if (gen !== generation || !active) return;
    if (img.dataset.sfSrc !== src || getState(img) !== 'pending') return; // Bild hat inzwischen gewechselt
    if (res && res.ok) {
      img.__sfOcr = res.text;
      const kw = matcher.find(res.text);
      if (kw) hitImage(img, kw);
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
    if (settings.onError === 'hide') hitImage(img, 'Bild nicht prüfbar');
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

  function hitImage(img, kw) {
    setState(img, 'hit');
    hit(img, kw);
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
      parts.push(img.getAttribute('alt') || '', img.getAttribute('title') || '', img.__sfOcr || '');
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
      scoredBlocks.add(block);
      const text = blockText(block);
      if (text.length >= 25) {
        const s = learningHides() ? L.score(model, text) : null;
        if (s && s.known >= 3 && s.p >= settings.learnThreshold) {
          hit(block, `gelernt, ${Math.round(s.p * 100)} %`, { block, force: true });
        } else if (semanticOn()) {
          semQueue.add(block);
        }
      }
      if (budget() <= 1) break;
    }
    if (learnCandidates.size) learnHandle = requestIdle(learnWork);
    flushSem();
    reportCount();
  }

  /* ---------------- Bedeutungs-Filter (Stufe 2) ---------------- */

  const SEM_BATCH = 24;
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
    if (gen !== generation || !active) return;
    if (res && res.ok) {
      res.results.forEach((r, i) => {
        const b = blocks[i];
        if (r.hide && b.isConnected) hit(b, 'Bedeutung', { block: b });
      });
      reportCount();
    } else if (res && /nicht installiert|aus/.test(res.error || '')) {
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

  function toast(text) {
    const t = document.createElement('div');
    t.className = 'sf-toast';
    t.textContent = text;
    (document.body || document.documentElement).appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  /** Rechtsklickmenü: "Will ich nicht sehen" / "Will ich sehen". */
  function onContextAction(action) {
    const target = lastCtxTarget;
    if (!target || !target.isConnected) return;
    const el = target.nodeType === 1 ? target : target.parentElement;
    if (!el) return;
    if (action === 'zone') { startZonePicker(el); return; }
    const ph = el.closest('.sf-placeholder');
    const hidden = ph ? ph.__sfBlock : el.closest('[data-sf-hit]');
    if (action === 'block') {
      if (hidden) {
        train(hidden, 'b');
        suggestBar(hidden);
        return;
      }
      const block = findBlock(el.closest('.sf-feedback') ? el.closest('.sf-feedback').__sfBlock : el);
      if (!block || block === document.body || block === document.documentElement) {
        toast('Hier wurde kein einzelner Inhaltsblock erkannt.');
        return;
      }
      train(block, 'b');
      if (active) {
        delete block.dataset.sfRevealed;
        clearedBlocks.delete(block);
        hit(block, 'von dir ausgeblendet', { block, force: true });
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
      hit(block, kw, { block, force: true });
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
    const label = document.createElement('span');
    label.textContent = text;
    b.append(ring, label);
    let timer = null;
    let done = false;
    const start = (ev) => {
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
        hit(el, 'Bereich', { block: el, force: true });
      }
    }
  }

  async function removeZone(z) {
    const s = await S.load();
    await S.save({ zones: s.zones.filter((x) => !(x.host === z.host && x.sel === z.sel && x.head === z.head)) });
    toast('Bereich wird nicht mehr gesperrt');
  }

  function showZoneChoices(block) {
    const bar = overlayBar(block);
    const label = document.createElement('span');
    label.textContent = 'Gesperrter Bereich';
    const show = revealButton('Nur anzeigen', () => { closeBar(block); reveal(block, null, { feedback: false }); });
    const del = button('Nicht mehr sperren', () => { closeBar(block); removeZone(block.__sfZone); });
    const close = button('×', () => closeBar(block));
    bar.append(label, show, del, close);
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

  function hit(el, kw, opts) {
    opts = opts || {};
    const block = opts.block || findBlock(el);
    if (!opts.force && clearedBlocks.has(block)) return;
    if (block.dataset.sfHit || block.dataset.sfRevealed || block.closest('[data-sf-hit]')) return;
    // Lernfilter: Schlagwort trifft, aber laut Bewertungen will der Nutzer das sehen.
    if (!opts.force && learningActive()) {
      const s = L.score(model, blockText(block));
      if (s && s.known >= 2 && s.p < LEARN_KEEP) {
        clearedBlocks.add(block);
        block.dataset.sfLearnOk = String(Math.round(s.p * 100));
        return;
      }
    }
    block.dataset.sfHit = kw;
    // Bereits markierte Treffer im Inneren zählen nicht doppelt.
    for (const inner of hitBlocks) if (block.contains(inner)) unhide(inner);
    hitBlocks.add(block);

    if (settings.display === 'hide') {
      block.classList.add('sf-hidden');
    } else if (settings.display === 'blur') {
      // Nur unscharf, ohne Hinweis auf das Schlagwort und ohne Knöpfe; Klick zeigt den Inhalt.
      block.classList.add('sf-blurred');
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
  }

  function unhide(block) {
    if (block.__sfBar && !block.__sfBar.contains(document.activeElement)) closeBar(block);
    block.classList.remove('sf-hidden', 'sf-blurred', 'sf-hidden-ph');
    block.removeEventListener('click', onBlurClick, true);
    if (block.__sfPlaceholder) { block.__sfPlaceholder.remove(); block.__sfPlaceholder = null; }
    delete block.dataset.sfHit;
    hitBlocks.delete(block);
  }

  /** Klick auf einen unscharfen Block: Bewertungsleiste über dem Block (Block bleibt unscharf). */
  function onBlurClick(ev) {
    const block = ev.currentTarget;
    ev.preventDefault();
    ev.stopPropagation();
    if (block.__sfBar && block.__sfBar.isConnected) { closeBar(block); return; }
    if (block.__sfZone) showZoneChoices(block);
    else showChoices(block);
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
    bar.style.setProperty('top', `${Math.max(0, r.top + window.scrollY + 6)}px`, 'important');
    bar.style.setProperty('left', `${Math.max(0, r.left + window.scrollX + 6)}px`, 'important');
    bar.style.setProperty('max-width', `${Math.max(220, r.width - 12)}px`, 'important');
    (document.body || document.documentElement).appendChild(bar);
    // Klick außerhalb schließt die Leiste.
    const outside = (e) => {
      if (!bar.isConnected) { document.removeEventListener('click', outside, true); return; }
      if (bar.contains(e.target) || block.contains(e.target)) return;
      document.removeEventListener('click', outside, true);
      closeBar(block);
    };
    setTimeout(() => document.addEventListener('click', outside, true), 0);
    return bar;
  }

  function showChoices(block) {
    const kw = block.dataset.sfHit;
    const bar = overlayBar(block);
    const done = (text) => {
      bar.textContent = text;
      setTimeout(() => closeBar(block), 1300);
    };
    const keep = button('Passt so', () => { train(block, 'b'); done('Gemerkt – bleibt unscharf.'); });
    keep.title = 'Richtig ausgeblendet – merken';
    const want = revealButton('Will ich sehen', () => {
      train(block, 'o');
      reveal(block, null, { feedback: false });
      clearedBlocks.add(block);
      done('Gemerkt.');
    });
    want.title = settings.revealHold ? 'Gedrückt halten: anzeigen und merken' : 'Falsch ausgeblendet – anzeigen und merken';
    const show = revealButton('Nur anzeigen', () => {
      reveal(block, null, { feedback: false });
      askAfterReveal(block, kw);
    });
    const close = button('×', () => closeBar(block));
    close.title = 'Schließen';
    bar.append(keep, want, show, close);
  }

  /** Nach „Nur anzeigen“: nachträglich bewerten. */
  function askAfterReveal(block, kw) {
    const bar = overlayBar(block);
    const label = document.createElement('span');
    label.textContent = 'War das Ausblenden richtig?';
    const yes = button('Ja, wieder ausblenden', () => {
      train(block, 'b');
      closeBar(block);
      delete block.dataset.sfRevealed;
      for (const img of block.querySelectorAll('img')) delete img.dataset.sfRevealed;
      hit(block, kw, { block, force: true });
    });
    const no = button('Nein, will ich sehen', () => {
      train(block, 'o');
      clearedBlocks.add(block);
      bar.textContent = 'Gemerkt.';
      setTimeout(() => closeBar(block), 1300);
    });
    const close = button('×', () => closeBar(block));
    bar.append(label, yes, no, close);
    setTimeout(() => { if (block.__sfBar === bar) closeBar(block); }, 30000);
  }

  function reveal(block, ph, opts) {
    const kw = block.dataset.sfHit;
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
    const n = hitBlocks.size;
    if (n === lastReported) return;
    lastReported = n;
    try {
      chrome.runtime.sendMessage({ type: 'count', n }).catch(() => {});
    } catch (_) { /* Erweiterung neu geladen */ }
  }

  init();
})();
