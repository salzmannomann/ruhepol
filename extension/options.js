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
      const wrap = document.createElement('div');
      wrap.className = 'preset';
      const label = document.createElement('label');
      label.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = p.id;
      cb.name = 'preset';
      const span = document.createElement('span');
      span.textContent = `${p.name} (${p.terms.length} Begriffe)`;
      label.append(cb, span);
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
        status(`${add.length} Begriffe übernommen – Speichern nicht vergessen.`, 'ok');
      });
      terms.append(document.createElement('br'), copy);
      det.append(sum, terms);
      wrap.append(label, det);
      box.append(wrap);
    }
  }

  function fill(s) {
    for (const cb of document.querySelectorAll('input[name="preset"]')) cb.checked = s.presets.includes(cb.value);
    $('keywords').value = s.keywords.join('\n');
    $('allow').value = s.allow.join('\n');
    $('learn').checked = s.learn;
    $('learnHide').checked = s.learnHide;
    $('learnThreshold').value = String(s.learnThreshold);
    $('siteList').value = s.siteList.join('\n');
    document.querySelector(`input[name="siteMode"][value="${s.siteMode}"]`).checked = true;
    document.querySelector(`input[name="display"][value="${s.display}"]`).checked = true;
    $('minWidth').value = s.minWidth;
    $('minHeight').value = s.minHeight;
    $('ocr').checked = s.ocr;
    $('partial').checked = s.partial;
    $('fuzzy').checked = s.fuzzy;
    $('onError').value = s.onError;
  }

  function read() {
    return {
      keywords: lines($('keywords').value),
      allow: lines($('allow').value),
      learn: $('learn').checked,
      learnHide: $('learnHide').checked,
      learnThreshold: Number($('learnThreshold').value),
      presets: [...document.querySelectorAll('input[name="preset"]:checked')].map((cb) => cb.value),
      siteList: lines($('siteList').value),
      siteMode: document.querySelector('input[name="siteMode"]:checked').value,
      display: document.querySelector('input[name="display"]:checked').value,
      minWidth: Number($('minWidth').value),
      minHeight: Number($('minHeight').value),
      ocr: $('ocr').checked,
      partial: $('partial').checked,
      fuzzy: $('fuzzy').checked,
      onError: $('onError').value,
    };
  }

  function status(text, kind) {
    const el = $('status');
    el.textContent = text;
    el.className = kind || '';
    clearTimeout(statusTimer);
    if (kind === 'ok') statusTimer = setTimeout(() => { el.textContent = ''; }, 2500);
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

  async function refreshCacheInfo() {
    const r = await chrome.runtime.sendMessage({ type: 'cacheSize' });
    const n = (r && r.n) || 0;
    $('cacheInfo').textContent = n === 1 ? '1 Bild im Cache' : `${n} Bilder im Cache`;
  }

  async function save() {
    try {
      const s = await S.save(read());
      fill(s);
      status('Gespeichert.', 'ok');
    } catch (e) {
      status('Speichern fehlgeschlagen: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  $('save').addEventListener('click', save);
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
    a.download = `schlagwortfilter-${new Date().toISOString().slice(0, 10)}.json`;
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
      const s = S.sanitize(raw);
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
  });
  $('presetsNone').addEventListener('click', () => {
    for (const cb of document.querySelectorAll('input[name="preset"]')) cb.checked = false;
  });

  $('resetLearn').addEventListener('click', async () => {
    if (!confirm('Alle Bewertungen und das Gelernte löschen?')) return;
    await chrome.runtime.sendMessage({ type: 'resetLearning' });
    status('Gelerntes zurückgesetzt.', 'ok');
    refreshLearn();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.model) refreshLearn();
  });

  buildPresets();
  refreshLearn();
  fill(await S.load());
  refreshCacheInfo();
})();
