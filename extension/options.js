'use strict';
(async function () {
  const S = globalThis.SFSettings;
  const P = globalThis.SFPresets;
  const $ = (id) => document.getElementById(id);
  let statusTimer = null;

  function lines(text) {
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }

  function buildPresets() {
    const box = $('presets');
    for (const p of P.PRESETS) {
      const card = document.createElement('div');
      card.className = 'topic';
      const label = document.createElement('label');
      const name = document.createElement('span');
      name.textContent = p.name;
      const count = document.createElement('small');
      count.textContent = `${p.terms.length} Begriffe`;
      name.append(count);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'switch-sm';
      cb.value = p.id;
      cb.name = 'preset';
      cb.setAttribute('aria-label', p.name);
      label.append(name, cb);
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = 'Begriffe anzeigen';
      const terms = document.createElement('div');
      terms.className = 'terms';
      terms.textContent = p.terms.join(' · ');
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'In eigene Liste kopieren';
      copy.addEventListener('click', () => {
        const have = new Set(lines($('keywords').value).map((l) => l.toLowerCase()));
        const add = p.terms.filter((t) => !have.has(t.toLowerCase()));
        $('keywords').value = lines($('keywords').value).concat(add).join('\n');
        dirty.add('keywords');
        save(`${add.length} Begriffe in die eigene Liste übernommen`);
      });
      terms.append(document.createElement('br'), copy);
      det.append(sum, terms);
      card.append(label, det);
      box.append(card);
    }
  }

  /* Navigation: Bereich aus der Adresse (#themen …), Standard „Themen“. */
  const PAGES = ['themen', 'erkennung', 'darstellung', 'seiten', 'erweitert'];
  function showPage() {
    const id = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'themen';
    for (const pg of PAGES) document.getElementById('page-' + pg).classList.toggle('active', pg === id);
    for (const a of document.querySelectorAll('nav a[data-page]')) {
      if (a.dataset.page === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', showPage);
  showPage();

  let currentZones = [];

  function renderZones(zones) {
    currentZones = zones.slice();
    const ul = $('zones');
    ul.textContent = '';
    for (const z of currentZones) {
      const li = document.createElement('li');
      const host = document.createElement('span');
      host.className = 'lbl';
      host.textContent = z.host;
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = z.label ? `„${z.label}“ (${z.sel})` : z.sel;
      txt.title = z.sel;
      const del = document.createElement('button');
      del.textContent = '×';
      del.title = 'Bereich nicht mehr sperren';
      del.addEventListener('click', async () => {
        const s = await S.save({ zones: currentZones.filter((x) => x !== z) });
        renderZones(s.zones);
        status('Bereich entfernt.', 'ok');
      });
      li.append(host, txt, del);
      ul.append(li);
    }
    if (!currentZones.length) ul.innerHTML = '<li>Keine.</li>';
  }

  function fill(s) {
    for (const cb of document.querySelectorAll('input[name="preset"]')) cb.checked = s.presets.includes(cb.value);
    $('keywords').value = s.keywords.join('\n');
    $('allow').value = s.allow.join('\n');
    $('learn').checked = s.learn;
    $('learnHide').checked = s.learnHide;
    // Auf die nächste Auswahl einrasten (Importe können Zwischenwerte enthalten).
    const opts = [...$('learnThreshold').options].map((o) => Number(o.value));
    $('learnThreshold').value = String(opts.reduce((a, b) => (Math.abs(b - s.learnThreshold) < Math.abs(a - s.learnThreshold) ? b : a)));
    $('siteList').value = s.siteList.join('\n');
    document.querySelector(`input[name="siteMode"][value="${s.siteMode}"]`).checked = true;
    document.querySelector(`input[name="display"][value="${s.display}"]`).checked = true;
    $('minWidth').value = s.minWidth;
    $('minHeight').value = s.minHeight;
    $('ocr').checked = s.ocr;
    $('partial').checked = s.partial;
    $('fuzzy').checked = s.fuzzy;
    $('onError').value = s.onError;
    $('revealHold').checked = s.revealHold;
    $('semantic').checked = s.semantic;
    $('semanticLevel').value = s.semanticLevel;
    $('semanticVeto').checked = s.semanticVeto;
    $('positiveShow').checked = s.positiveShow;
    $('positiveLevel').value = s.positiveLevel;
    renderZones(s.zones);
  }

  function read() {
    return {
      keywords: lines($('keywords').value),
      allow: lines($('allow').value),
      learn: $('learn').checked,
      learnHide: $('learnHide').checked,
      learnThreshold: $('learnThreshold').value === '' ? null : Number($('learnThreshold').value),
      presets: [...document.querySelectorAll('input[name="preset"]:checked')].map((cb) => cb.value),
      siteList: lines($('siteList').value),
      siteMode: document.querySelector('input[name="siteMode"]:checked').value,
      display: document.querySelector('input[name="display"]:checked').value,
      minWidth: $('minWidth').value === '' ? null : Number($('minWidth').value),
      minHeight: $('minHeight').value === '' ? null : Number($('minHeight').value),
      ocr: $('ocr').checked,
      partial: $('partial').checked,
      fuzzy: $('fuzzy').checked,
      onError: $('onError').value,
      revealHold: $('revealHold').checked,
      semantic: $('semantic').checked,
      semanticLevel: $('semanticLevel').value,
      semanticVeto: $('semanticVeto').checked,
      positiveShow: $('positiveShow').checked,
      positiveLevel: $('positiveLevel').value,
      zones: currentZones,
    };
  }

  function status(text, kind) {
    const el = $('status');
    el.textContent = text;
    el.className = kind || '';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { el.className = ''; }, kind === 'err' ? 6000 : 1800);
  }

  async function refreshLearn() {
    const info = await chrome.runtime.sendMessage({ type: 'learnInfo' });
    if (!info) return;
    const st = $('learnStatus');
    if (!info.total) {
      st.textContent = 'Noch keine Bewertungen.';
    } else if (!info.ready) {
      const need = Math.max(info.minTotal - info.total, info.minEach - info.b, info.minEach - info.o, 0);
      st.textContent = `${info.total} Bewertungen (${info.b} ausblenden, ${info.o} anzeigen). ` +
        `Der Lernfilter greift ab ${info.minTotal} Bewertungen mit je mindestens ${info.minEach} pro Richtung – noch etwa ${need}.`;
    } else {
      st.textContent = `${info.total} Bewertungen (${info.b} ausblenden, ${info.o} anzeigen). Der Lernfilter ist aktiv.`;
    }
    const fill = (el, list) => {
      el.textContent = '';
      for (const w of list) {
        const li = document.createElement('li');
        li.textContent = `${w.word} (${w.b}× aus, ${w.o}× an)`;
        el.append(li);
      }
      if (!list.length) el.innerHTML = '<li>–</li>';
    };
    fill($('topB'), info.top.b);
    fill($('topO'), info.top.o);
    const ul = $('recent');
    ul.textContent = '';
    for (const r of info.recent) {
      const li = document.createElement('li');
      const lbl = document.createElement('span');
      lbl.className = 'lbl ' + r.label;
      lbl.textContent = r.label === 'b' ? 'ausblenden' : 'anzeigen';
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = (r.host ? r.host + ': ' : '') + r.text;
      txt.title = r.text;
      const del = document.createElement('button');
      del.textContent = '×';
      del.title = 'Bewertung löschen';
      del.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'deleteRating', id: r.id });
        refreshLearn();
      });
      li.append(lbl, txt, del);
      ul.append(li);
    }
    if (!info.recent.length) ul.innerHTML = '<li>Noch keine.</li>';
  }

  async function refreshSem() {
    const st = await chrome.runtime.sendMessage({ type: 'semStatus' });
    const el = $('semStatus');
    if (!st) return;
    const name = st.model.split('/').pop();
    if (!st.installed) {
      el.textContent = `Sprachmodell (${name}) ist nicht installiert. Die Datei „model_quantized.onnx“ von Hugging Face in den Ordner „vendor/models/${st.model}/onnx/“ der Erweiterung legen (oder im Projektordner „npm run fetch-model“ ausführen) und die Erweiterung neu laden.`;
      $('semantic').disabled = !$('semantic').checked;
    } else {
      el.textContent = `Sprachmodell ${name} ist installiert.` + (st.indexed ? ` ${st.indexed} Bewertungen eingerechnet.` : '');
      $('semantic').disabled = false;
    }
  }

  async function refreshCacheInfo() {
    const r = await chrome.runtime.sendMessage({ type: 'cacheSize' });
    const n = (r && r.n) || 0;
    $('cacheInfo').textContent = n === 1 ? '1 Bild im Cache' : `${n} Bilder im Cache`;
  }

  /*
   * Sofort speichern: Schalter, Auswahlfelder und Optionen sofort, Textfelder kurz nach dem
   * letzten Tastendruck. Die Felder werden dabei nicht neu befüllt, damit beim Tippen nichts springt.
   */
  let saveTimer = null;
  let saving = Promise.resolve();
  // Nur geänderte Felder speichern: sonst überschriebe ein Klick hier Schlagwörter oder
  // Seiten, die inzwischen über Kontextmenü oder Popup dazukamen.
  const dirty = new Set();

  function keyOf(el) {
    if (el.name === 'preset') return 'presets';
    return el.name || el.id;
  }

  function save(message) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saving = saving.then(async () => {
      const all = read();
      const part = {};
      for (const k of dirty) if (k in all) part[k] = all[k];
      dirty.clear();
      if (!Object.keys(part).length) return;
      try {
        await S.save(part);
        status(message || 'Gespeichert ✓', 'ok');
      } catch (e) {
        status('Speichern fehlgeschlagen: ' + (e && e.message ? e.message : e), 'err');
      }
    });
    return saving;
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(), 600);
  }

  const form = document.querySelector('main');
  form.addEventListener('change', (e) => {
    if (e.target.id === 'importFile') return;
    if (e.target.matches('input, select, textarea')) {
      dirty.add(keyOf(e.target));
      save();
    }
  });
  form.addEventListener('input', (e) => {
    if (e.target.matches('textarea, input[type="number"]')) {
      dirty.add(keyOf(e.target));
      saveSoon();
    }
  });
  // beforeunload wartet nicht auf asynchrones Speichern; beim Verbergen bleibt noch Zeit.
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) save(); });
  window.addEventListener('beforeunload', () => { if (saveTimer) save(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
  });

  $('clearCache').addEventListener('click', async () => {
    const r = await chrome.runtime.sendMessage({ type: 'cacheClear' });
    status(`Cache geleert (${(r && r.removed) || 0} Einträge).`, 'ok');
    refreshCacheInfo();
  });

  $('export').addEventListener('click', async () => {
    const s = await S.load();
    const { ratings } = await chrome.runtime.sendMessage({ type: 'exportRatings' });
    const data = JSON.stringify({ format: 'schlagwortfilter', version: 2, settings: s, ratings }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ruhepol-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('import').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const raw = json && json.format === 'schlagwortfilter' ? json.settings : json;
      if (!raw || typeof raw !== 'object') throw new Error('keine Einstellungen gefunden');
      // Offene Änderungen zuerst speichern, dann den Import auf die aktuellen Einstellungen legen
      // (eine Datei nur mit Schlagwörtern setzt den Rest nicht auf Standard zurück).
      await save();
      const s = S.sanitize(Object.assign(await S.load(), raw));
      await chrome.storage.sync.set(s);
      fill(s);
      let msg = 'Einstellungen importiert.';
      if (json && Array.isArray(json.ratings)) {
        const r = await chrome.runtime.sendMessage({ type: 'importRatings', ratings: json.ratings });
        msg = `Einstellungen und Bewertungen importiert (${(r && r.n) || 0} Bewertungen).`;
        refreshLearn();
      }
      status(msg, 'ok');
    } catch (err) {
      status('Import fehlgeschlagen: ' + err.message, 'err');
    }
  });

  $('presetsAll').addEventListener('click', () => {
    for (const cb of document.querySelectorAll('input[name="preset"]')) cb.checked = true;
    dirty.add('presets');
    save('Alle Listen aktiv');
  });
  $('presetsNone').addEventListener('click', () => {
    for (const cb of document.querySelectorAll('input[name="preset"]')) cb.checked = false;
    dirty.add('presets');
    save('Alle Listen aus');
  });

  $('resetLearn').addEventListener('click', async () => {
    if (!confirm('Alle Bewertungen und das Gelernte löschen?')) return;
    await chrome.runtime.sendMessage({ type: 'resetLearning' });
    status('Gelerntes zurückgesetzt.', 'ok');
    refreshLearn();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    // Bereiche werden meist auf der Seite angelegt; Liste aktuell halten, damit das Speichern sie nicht überschreibt.
    if (area === 'sync' && changes.zones) renderZones(S.sanitize({ zones: changes.zones.newValue || [] }).zones);
    // Listen, die auch Kontextmenü und Popup ändern: anzeigen, solange hier nicht getippt wird.
    if (area === 'sync') {
      const lists = { keywords: 'keywords', allow: 'allow', siteList: 'siteList' };
      for (const [key, id] of Object.entries(lists)) {
        if (!changes[key] || dirty.has(key) || document.activeElement === $(id)) continue;
        $(id).value = S.sanitize({ [key]: changes[key].newValue || [] })[key].join('\n');
      }
      if (changes.presets && !dirty.has('presets')) {
        const ids = S.sanitize({ presets: changes.presets.newValue || [] }).presets;
        for (const cb of document.querySelectorAll('input[name="preset"]')) cb.checked = ids.includes(cb.value);
      }
    }
    if (area === 'local' && changes.model) refreshLearn();
  });

  buildPresets();
  refreshLearn();
  refreshSem();
  fill(await S.load());
  refreshCacheInfo();
})();
