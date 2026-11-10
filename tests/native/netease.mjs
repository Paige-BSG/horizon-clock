// Real-account acceptance: run only in an authorized, isolated native-qa instance.
// Returns counts/measurements only; account contents and credentials stay in memory.
export default async function neteaseSmoke() {
  const $ = (id) => document.getElementById(id);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
  async function until(fn, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await pause(100);
    }
    return false;
  }
  const api = (action) => window.__TAURI__.core.invoke('netease', { action });
  if ($('music-panel').hidden) $('music-open').click();
  $('music-netease').click();
  check(
    'restored saved session in HORIZON',
    await until(() => $('netease-account-status').textContent === '已登录')
  );
  const library = await api({ type: 'restore' });
  check(
    'account playlists available without autoplay',
    library.playlists.length > 0 && library.playback.state === 'stopped',
    { playlists: library.playlists.length }
  );
  const list = library.playlists.find((p) => p.count > 0);
  if (!list) throw new Error('No populated account playlist for acceptance');
  $('netease-playlists').value = list.id;
  $('netease-playlists').dispatchEvent(new Event('change'));
  check('own playlist loads', await until(() => $('netease-tracks').children.length > 0), {
    expected: Math.min(100, list.count),
  });
  const loaded = $('netease-tracks').children.length;
  if (!$('netease-more').hidden) {
    $('netease-more').click();
    check(
      'pagination loads next page',
      await until(() => $('netease-tracks').children.length > loaded),
      { firstPage: loaded, totalLoaded: $('netease-tracks').children.length }
    );
  }
  check(
    'no stream before track click',
    (await api({ type: 'status' })).playback.state === 'stopped'
  );
  $('netease-tracks').firstElementChild.click();
  check(
    'native track starts',
    await until(() => $('music-panel').dataset.state === 'playing', 20000)
  );
  if ($('music-motion').getAttribute('aria-pressed') === 'true') {
    $('settings-open').click();
    $('display-tab').click();
    $('music-motion').click();
    $('settings-close').click();
  }
  check(
    'actual own-player waveform',
    await until(
      () =>
        Number($('music-panel').dataset.audioRms) > 0 &&
        Number($('music-panel').dataset.wavePeak) > 0
    ),
    {
      rms: Number($('music-panel').dataset.audioRms),
      peak: Number($('music-panel').dataset.wavePeak),
    }
  );
  $('music-toggle').click();
  check(
    'pause is flat',
    await until(
      () =>
        $('music-panel').dataset.state === 'paused' &&
        Number($('music-panel').dataset.wavePeak) === 0
    )
  );
  $('music-toggle').click();
  check('resume plays', await until(() => $('music-panel').dataset.state === 'playing'));
  $('music-volume').value = 42;
  $('music-volume').dispatchEvent(new Event('change'));
  check(
    'application volume changes',
    await until(() => $('music-volume-value').textContent === '42%')
  );
  $('music-volume').value = 50;
  $('music-volume').dispatchEvent(new Event('change'));
  await until(() => $('music-volume-value').textContent === '50%');
  $('music-close').click();
  check(
    'collapse preserves intentional playback',
    (await api({ type: 'status' })).playback.state === 'playing'
  );
  $('music-open').click();
  $('music-radio').click();
  check(
    'source switch waits for native stop',
    await until(
      () => $('music-radio').getAttribute('aria-pressed') === 'true' && !$('music-radio').disabled
    )
  );
  check(
    'native source stopped, radio not auto-started',
    (await api({ type: 'status' })).playback.state === 'stopped' &&
      !document.getElementById('radio-stream')
  );
  $('music-netease').click();
  check(
    'return restores account without autoplay',
    (await until(
      () => $('netease-account-status').textContent === '已登录' && !$('music-netease').disabled
    )) && (await api({ type: 'status' })).playback.state === 'stopped'
  );
  check(
    'clock remains visible and live',
    $('hours').textContent !== '--' &&
      document.querySelector('.clock-information').getBoundingClientRect().width > 0
  );
  return { results };
}
