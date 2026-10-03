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
      return false;
    });
  }

  function apply() {
    teardown();
    const host = location.hostname || (window.top !== window ? safeTopHost() : '');
    const keywords = S.allKeywords(settings);
    const shouldRun = S.isActiveOn(settings, host) && (keywords.length > 0 || learningHides());
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
    observer.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'alt', 'title', 'aria-label'],
    });
    document.addEventListener('load', onLoadCapture, true);
    document.addEventListener('error', onErrorCapture, true);

    // Bilder sofort markieren, Text dann im Leerlauf prüfen.
    enqueue(document.documentElement);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => active && enqueue(document.documentElement), { once: true });
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
    if (idleHandle) cancelIdle(idleHandle);
    if (learnHandle) cancelIdle(learnHandle);
    idleHandle = learnHandle = null;
    document.removeEventListener('load', onLoadCapture, true);
    document.removeEventListener('error', onErrorCapture, true);
    document.documentElement.classList.remove('sf-active');
    for (const el of document.querySelectorAll('.sf-placeholder, .sf-feedback, .sf-toast')) el.remove();
    for (const el of document.querySelectorAll('[data-sf-hit]')) {
      el.classList.remove('sf-hidden', 'sf-blurred', 'sf-hidden-ph');
      delete el.dataset.sfHit;
    }
    for (const el of document.querySelectorAll('img[data-sf]')) {
      delete el.dataset.sf;
      delete el.dataset.sfSrc;
    }
    hitBlocks.clear();
  }

  /* ---------------- Planung (requestIdleCallback, gedrosselter Observer) ---------------- */

  const requestIdle = window.requestIdleCallback
    ? (cb) => window.requestIdleCallback(cb, { timeout: 500 })
    : (cb) => setTimeout(() => cb({ timeRemaining: () => IDLE_BUDGET_MS, didTimeout: true }), 16);
  const cancelIdle = window.cancelIdleCallback || clearTimeout;

  function enqueue(node) {
    if (!active || !node) return;
    // Bilder sofort unscharf stellen (nicht erst im Leerlauf).
    if (node.nodeType === 1) markImagesNow(node);
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
        if (el.tagName === 'IMG' || el.tagName === 'SOURCE') {
          const img = el.tagName === 'IMG' ? el : el.parentElement && el.parentElement.querySelector('img');
          if (img) processImage(img);
        } else {
          enqueue(el);
        }
      }
    }
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
    if (root.nodeType !== 1 && root.nodeType !== 9) return null;
    const start = root.nodeType === 9 ? root.documentElement : root;
    if (!start || skipElement(start)) return null;

    checkElementAttrs(start);
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
    if (el.tagName === 'IMG') {
      processImage(el);
      return;
    }
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
    if (!src || img.dataset.sf !== 'pending') return;
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
    if (img.dataset.sfSrc !== src || img.dataset.sf !== 'pending') return; // Bild hat inzwischen gewechselt
    if (res && res.ok) {
      img.__sfOcr = res.text;
      const kw = matcher.find(res.text);
      if (kw) hitImage(img, kw);
      else {
        img.dataset.sf = 'ok';
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
    else if (settings.onError === 'blur') img.dataset.sf = 'err';
    else img.dataset.sf = 'ok';
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
    img.dataset.sf = 'hit';
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

  function learnHandleable() {
    return active && learningHides();
  }

  function scheduleLearn() {
    if (learnCandidates.size && !learnHandle && active) learnHandle = requestIdle(learnWork);
  }

  /** Text eines Blocks inkl. alt-Texten und OCR-Text der Bilder (für Lernfilter und Bewertungen). */
  function blockText(block) {
    const parts = [block.textContent || ''];
    const imgs = block.tagName === 'IMG' ? [block] : block.querySelectorAll('img');
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
        const s = L.score(model, text);
        if (s && s.known >= 3 && s.p >= settings.learnThreshold) {
          hit(block, `gelernt, ${Math.round(s.p * 100)} %`, { block, force: true });
        }
      }
      if (budget() <= 1) break;
    }
    if (learnCandidates.size) learnHandle = requestIdle(learnWork);
    reportCount();
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
    const ph = el.closest('.sf-placeholder');
    const hidden = ph ? ph.__sfBlock : el.closest('[data-sf-hit]');
    if (action === 'block') {
      if (hidden) {
        train(hidden, 'b');
        toast('Gemerkt: will ich nicht sehen');
        return;
      }
      const block = findBlock(el.closest('.sf-feedback') ? el.closest('.sf-feedback').__sfBlock : el);
      if (!block || block === document.body || block === document.documentElement) {
        toast('Hier wurde kein einzelner Inhaltsblock erkannt.');
        return;
      }
      train(block, 'b');
      if (!active) { toast('Gemerkt: will ich nicht sehen'); return; }
      delete block.dataset.sfRevealed;
      clearedBlocks.delete(block);
      hit(block, 'von dir ausgeblendet', { block, force: true });
      toast('Ausgeblendet und gemerkt');
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

  /** Nach dem Aufdecken kurz nachfragen, ob das Ausblenden richtig war. */
  function showFeedback(block, kw) {
    if (!block.parentNode) return;
    const bar = document.createElement('div');
    bar.className = 'sf-feedback';
    bar.__sfBlock = block;
    const label = document.createElement('span');
    label.textContent = `Ausgeblendet wegen „${kw}“. War das richtig?`;
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

  function button(text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sf-btn';
    b.textContent = text;
    b.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); onClick(); });
    return b;
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
      block.classList.add('sf-blurred');
      block.title = `Ausgeblendet (${kw}) – klicken zum Anzeigen (Rechtsklick: bewerten)`;
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
      label.textContent = `Ausgeblendet (${kw})`;
      const actions = document.createElement('span');
      actions.className = 'sf-ph-actions';
      const keep = button('Passt so', () => {
        train(block, 'b');
        actions.textContent = '✓ gemerkt';
      });
      keep.title = 'Richtig ausgeblendet – merken';
      const want = button('Will ich sehen', () => {
        train(block, 'o');
        reveal(block, ph, { feedback: false });
        toast('Gemerkt: will ich sehen');
      });
      want.title = 'Falsch ausgeblendet – anzeigen und merken';
      actions.append(button('Anzeigen', () => reveal(block, ph)), keep, want);
      ph.append(label, actions);
      ph.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); reveal(block, ph); });
      label.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); reveal(block, ph); } });
      block.classList.add('sf-hidden-ph');
      block.parentNode && block.parentNode.insertBefore(ph, block);
      block.__sfPlaceholder = ph;
    }
    scheduleReport();
  }

  function unhide(block) {
    block.classList.remove('sf-hidden', 'sf-blurred', 'sf-hidden-ph');
    block.removeEventListener('click', onBlurClick, true);
    if (block.__sfPlaceholder) { block.__sfPlaceholder.remove(); block.__sfPlaceholder = null; }
    delete block.dataset.sfHit;
    hitBlocks.delete(block);
  }

  function onBlurClick(ev) {
    const block = ev.currentTarget;
    ev.preventDefault();
    ev.stopPropagation();
    reveal(block, null);
  }

  function reveal(block, ph, opts) {
    const kw = block.dataset.sfHit;
    unhide(block);
    if (ph) ph.remove();
    block.removeAttribute('title');
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
