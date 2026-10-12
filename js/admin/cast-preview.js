// Same renderCastView and Cast stylesheet as the operational screen. This
// preview accepts only same-origin parent messages and never joins a session.
(() => {
  const els = getCastViewElements(document);
  let sample = null;
  const sampleEndsAt = Date.now() + (17 * 60 + 42) * 1000;
  function render() {
    if (!sample) return;
    const seconds = 17 * 60 + 42;
    const mode = ['hint','win','lose'].includes(sample.mode) ? sample.mode : 'timer';
    const state = {
      roomName: sample.name || 'غرفة أحاجي', image: sample.background,
      roomConfig: { presentation: sample.presentation },
      status: mode === 'win' || mode === 'lose' ? 'ended' : 'running',
      remainingSeconds: seconds, endsAt: sampleEndsAt,
      viewMode: mode === 'win' || mode === 'lose' ? mode : 'normal',
      hintText: mode === 'hint' ? 'ابحثوا عن المفتاح خلف الباب' : '',
      hintExpiresAt: null
    };
    renderCastView(state, els);
    if (sample.backgroundPreview) els.bg.src = sample.backgroundPreview;
  }
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent ||
        event.data?.type !== 'ahaji-cast-preview') return;
    sample = event.data;
    render();
  });
  setInterval(render, 1000);
  parent.postMessage({ type: 'ahaji-cast-preview-ready' }, location.origin);
})();
