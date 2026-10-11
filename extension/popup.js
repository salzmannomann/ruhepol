'use strict';
(async function () {
  const S = globalThis.SFSettings;
  const $ = (id) => document.getElementById(id);

  // Für Tests: popup.html?tab=<id> statt des aktiven Tabs.
  const params = new URLSearchParams(location.search);
  let tab;
  if (params.get('tab')) tab = await chrome.tabs.get(Number(params.get('tab')));
  else [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  let host = '';
  try {
    const u = new URL(tab.url);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:') host = u.hostname;
  } catch (_) { /* keine URL */ }

  let settings = await S.load();

  function render() {
    $('global').checked = settings.enabled;
    $('host').textContent = host || 'nicht verfügbar';
    $('site').disabled = !host || !settings.enabled;
    $('site').checked = !!host && S.isActiveOn(Object.assign({}, settings, { enabled: true }), host);
    // Nachrichtenseite oder nicht: entscheidet, ob Bilder bis zur Prüfung unscharf sind.
    const K = globalThis.SFSiteKind;
    const news = !host || K.classify(host, settings.siteKinds) === 'news';
    $('kindRow').hidden = !host || !settings.enabled || !settings.calmImages || !$('site').checked;
    $('kind').checked = news;
    $('kindInfo').textContent = news
      ? 'Bilder bleiben unscharf, bis sie geprüft sind'
      : 'Keine Nachrichtenseite: Bilder sofort sichtbar, im Hintergrund geprüft';
    const n = settings.keywords.length;
    const p = settings.presets.length;
    $('kwInfo').textContent = (n === 1 ? '1 eigenes Schlagwort' : `${n} eigene Schlagwörter`) + (p ? ` + ${p} Listen` : '');
    const warn = $('warn');
    if (!S.allKeywords(settings).length) {
      warn.hidden = false;
      warn.textContent = 'Noch keine Schlagwörter eingetragen.';
    } else {
      warn.hidden = true;
    }
  }

  async function refreshCount() {
    if (!tab) return;
    const r = await chrome.runtime.sendMessage({ type: 'getCount', tabId: tab.id });
    const n = (r && r.n) || 0;
    $('count').textContent = n;
    $('countLabel').textContent = n === 1 ? 'ausgeblendetes Element auf dieser Seite' : 'ausgeblendete Elemente auf dieser Seite';
  }

  $('global').addEventListener('change', async (e) => {
    settings = await S.save({ enabled: e.target.checked });
    render();
  });

  $('site').addEventListener('change', async (e) => {
    settings = await S.save({ siteList: S.toggleHost(settings, host, e.target.checked) });
    render();
  });

  $('kind').addEventListener('change', async (e) => {
    const K = globalThis.SFSiteKind;
    const h = S.normalizeHost(host);
    const kinds = Object.assign({}, settings.siteKinds);
    const want = e.target.checked ? 'news' : 'calm';
    // Eintrag nur, wenn er von der eingebauten Einstufung abweicht.
    delete kinds[h];
    if (K.classify(h, kinds) !== want) kinds[h] = want;
    settings = await S.save({ siteKinds: kinds });
    render();
  });

  $('options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  async function refreshLearn() {
    const info = await chrome.runtime.sendMessage({ type: 'learnInfo' });
    if (!info || !settings.learn) { $('learnInfo').textContent = ''; return; }
    $('learnInfo').textContent = info.ready
      ? `Lernfilter aktiv (${info.total} Bewertungen)`
      : `Lernfilter: ${info.total} von ${info.minTotal} Bewertungen – Rechtsklick auf Artikel zum Bewerten`;
  }

  render();
  refreshCount();
  refreshLearn();
  setInterval(refreshCount, 1000);
})();
