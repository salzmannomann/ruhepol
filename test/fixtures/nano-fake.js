// Ersatz für Chromes LanguageModel im Offscreen Document (nur automatische Tests, siehe test/nano.mjs).
// Urteil: „harmlos“, wenn der Text „Konzert“ enthält, sonst „belastend“.
(function () {
  const session = () => ({
    async clone() { return session(); },
    destroy() {},
    async prompt(text) { return JSON.stringify({ urteil: /Konzert/.test(text) ? 'harmlos' : 'belastend' }); },
  });
  globalThis.LanguageModel = {
    async availability() { return 'available'; },
    async create() { return session(); },
  };
})();
