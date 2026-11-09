export default async function nativeSmoke() {
  const $ = (id) => document.getElementById(id);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  function check(name, pass, detail) {
    results.push({ name, pass: !!pass, detail });
  }
  async function until(fn, ms = 5000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await pause(100);
    }
    return false;
  }
  await until(() => $('hours').textContent !== '--', 10000);
  check('native engine', !!window.__TAURI__?.core, navigator.userAgent);
  const initial = $('seconds').textContent;
  await pause(1300);
  check('clock ticking', initial !== $('seconds').textContent, [initial, $('seconds').textContent]);
  const now = new Date();
  check(
    'local clock',
    $('hours').textContent === String(now.getHours()).padStart(2, '0'),
    $('hours').textContent
  );
  check('welcome offline consent', $('welcome-dialog').open && !$('welcome-weather').checked);
  $('welcome-city').value = '上海';
  $('welcome-form').requestSubmit();
  check('onboarding persisted', JSON.parse(localStorage.getItem('horizon-display-v1')).onboarded);
  $('fullscreen').click();
  check(
    'native leave fullscreen',
    await until(async () => !(await window.__TAURI__.core.invoke('get_fullscreen')))
  );
  $('fullscreen').click();
  check(
    'native enter fullscreen',
    await until(() => window.__TAURI__.core.invoke('get_fullscreen'))
  );
  await document.fonts.ready;
  check(
    'logical viewport fits at the current system scale',
    await until(() => document.documentElement.scrollHeight <= innerHeight + 1),
    { height: innerHeight, content: document.documentElement.scrollHeight, scale: devicePixelRatio }
  );
  const before = Number(document.body.style.getPropertyValue('--display-brightness'));
  $('night-toggle').click();
  await pause(1800);
  check(
    'night mode dims information',
    Number(document.body.style.getPropertyValue('--display-brightness')) < before,
    { before, after: document.body.style.getPropertyValue('--display-brightness') }
  );
  $('night-toggle').click();
  await pause(300);
  $('settings-open').click();
  $('system-tab').click();
  const baseline = $('autostart').checked;
  $('autostart').click();
  await until(() => !$('autostart').disabled);
  check(
    'native autostart toggle',
    (await window.__TAURI__.core.invoke('get_autostart')) === !baseline
  );
  $('autostart').click();
  await until(() => !$('autostart').disabled);
  check(
    'native autostart restored',
    (await window.__TAURI__.core.invoke('get_autostart')) === baseline
  );
  $('background-tab').click();
  document.querySelector('[data-period="day"]')?.click();
  document.querySelector('[data-collection="personal"]').click();
  const response = await fetch('assets/landscapes/coast.jpg');
  const blob = await response.blob();
  const fixture = new File([blob], 'qa-coast.jpg', { type: 'image/jpeg' });
  function importFixture() {
    const dt = new DataTransfer();
    dt.items.add(fixture);
    $('photo-files').files = dt.files;
    $('photo-files').dispatchEvent(new Event('change', { bubbles: true }));
  }
  importFixture();
  await until(() => $('photo-list').children.length === 1, 10000);
  check('WebKit photo import and decode', $('photo-list').children.length === 1, {
    status: $('photo-status').textContent,
    toast: $('toast').textContent,
  });
  check(
    'personal background renders',
    await until(() => document.querySelector('.landscape-layer.visible')?.src.startsWith('blob:'))
  );
  importFixture();
  await pause(1000);
  check(
    'photo duplicate skipped',
    $('photo-list').children.length === 1 && $('toast').textContent.includes('重复')
  );
  $('photo-x').value = '30';
  $('photo-x').dispatchEvent(new Event('input', { bubbles: true }));
  $('photo-x').dispatchEvent(new Event('change', { bubbles: true }));
  await pause(500);
  const photos = await import('./lib/photos.js');
  const list = await photos.listPhotos();
  check('photo stored in IndexedDB', list.length === 1 && list[0].image instanceof Blob, {
    count: list.length,
    size: list[0]?.image.size,
  });
  check('crop persisted', list[0]?.x === 30, list[0]?.x);
  const backup = await import('./lib/settings.js');
  const settings = JSON.parse(localStorage.getItem('horizon-display-v1'));
  const exported = JSON.parse(backup.exportSettings(settings));
  check(
    'backup excludes power and consent',
    !('awake' in exported.settings) && !('weatherEnabled' in exported.settings)
  );
  $('weather-tab').click();
  $('weather-enabled').click();
  await until(() => $('weather-status').textContent.startsWith('更新'), 12000);
  check(
    'real weather response',
    $('temperature-value').textContent !== '--' &&
      $('weather-status').textContent.startsWith('更新'),
    {
      temperature: $('temperature-value').textContent,
      status: $('weather-status').textContent,
      description: $('weather-description').textContent,
    }
  );
  $('settings-close').click();
  return {
    at: new Date().toISOString(),
    results,
    passed: results.filter((r) => r.pass).length,
    total: results.length,
    settings: JSON.parse(localStorage.getItem('horizon-display-v1')),
  };
}
