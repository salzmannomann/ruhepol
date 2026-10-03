/* Kennenlernen: Schlagzeilen einstufen → Themenauswahl (und ggf. Stufe) vorschlagen und speichern. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const QS = SFOnboarding.questions();
  const answers = new Array(QS.length).fill(null);
  let pos = 0;

  function show(step) {
    for (const el of document.querySelectorAll('.step')) el.classList.toggle('active', el.id === step);
  }

  function renderQuestion() {
    $('count').textContent = `${pos + 1} von ${QS.length}`;
    $('headline').textContent = QS[pos].text;
    $('bar').style.width = `${(pos / QS.length) * 100}%`;
    $('back').disabled = pos === 0;
  }

  function answer(a) {
    answers[pos] = a;
    if (pos + 1 < QS.length) { pos++; renderQuestion(); } else renderSummary();
  }

  function renderSummary() {
    const { presets, level } = SFOnboarding.infer(answers, QS);
    const box = $('topics');
    box.textContent = '';
    for (const p of SFPresets.PRESETS) {
      const label = document.createElement('label');
      label.className = 'topic';
      const name = document.createElement('span');
      name.textContent = p.name;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = p.id;
      cb.checked = presets.includes(p.id);
      label.append(name, cb);
      box.append(label);
    }
    $('levelRow').hidden = level !== 'stark';
    $('levelStark').checked = level === 'stark';
    show('summary');
  }

  async function apply() {
    const presets = [...document.querySelectorAll('#topics input:checked')].map((cb) => cb.value);
    const partial = { presets };
    if (!$('levelRow').hidden && $('levelStark').checked) partial.semanticLevel = 'stark';
    await SFSettings.save(partial);
    $('doneText').textContent = presets.length
      ? `Gespeichert. Ruhepol stellt ab jetzt ${presets.length} von ${SFPresets.PRESETS.length} Themen unscharf.`
      : 'Gespeichert. Es ist keine Themenliste aktiv – Ruhepol blendet nur noch eigene Schlagwörter aus.';
    show('done');
  }

  $('start').addEventListener('click', () => { pos = 0; renderQuestion(); show('ask'); });
  $('skip').addEventListener('click', () => window.close());
  $('ansYes').addEventListener('click', () => answer(true));
  $('ansNo').addEventListener('click', () => answer(false));
  $('dunno').addEventListener('click', () => answer(null));
  $('back').addEventListener('click', () => { if (pos > 0) { pos--; renderQuestion(); } });
  $('again').addEventListener('click', () => { answers.fill(null); pos = 0; renderQuestion(); show('ask'); });
  $('apply').addEventListener('click', () => apply().catch((e) => { $('doneText').textContent = `Speichern fehlgeschlagen: ${e.message || e}`; show('done'); }));
  $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('close').addEventListener('click', () => window.close());
})();
