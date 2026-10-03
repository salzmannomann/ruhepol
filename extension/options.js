'use strict';
(async function () {
  const S = globalThis.SFSettings;
  const $ = (id) => document.getElementById(id);
  let statusTimer = null;

  function lines(text) {
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }

  function fill(s) {
    $('keywords').value = s.keywords.join('\n');
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
    const data = JSON.stringify({ format: 'schlagwortfilter', version: 1, settings: s }, null, 2);
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
      status('Einstellungen importiert.', 'ok');
    } catch (err) {
      status('Import fehlgeschlagen: ' + err.message, 'err');
    }
  });

  fill(await S.load());
  refreshCacheInfo();
})();
