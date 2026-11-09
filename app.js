import { SETTINGS_KEY as storageKey, readSettings } from './lib/settings.js';
import { isDesktop, native } from './lib/desktop.js';
import { effectiveNight, nextNightBoundary } from './lib/night.js';
import {
  initializeProduct,
  renderProductSettings,
  applyNight,
  refreshWeather,
} from './lib/product.js';

const $ = (id) => document.getElementById(id);
let preferences = readSettings({ getItem: (key) => localStorage.getItem(key) });
const scenes = [
  { id: 'lake', name: '湖畔晨雾', src: 'assets/landscapes/lake.jpg' },
  { id: 'mountain', name: '群山之间', src: 'assets/landscapes/mountain.jpg' },
  { id: 'coast', name: '蓝色潮汐', src: 'assets/landscapes/coast.jpg' },
];
if (!scenes.some((scene) => scene.id === preferences.scene)) preferences.scene = 'lake';
if (!['solid', 'landscape'].includes(preferences.background)) preferences.background = 'landscape';
if (![30, 60, 300, 900].includes(preferences.interval)) preferences.interval = 60;
preferences.dim = Math.min(75, Math.max(35, Number(preferences.dim) || 45));
let sceneRequest = 0;
let activeLayer = null;
let rotationTimer;
let wakeLock = null;
let nativeAwake = false;
let toastTimer;
let idleTimer;
const dialog = $('settings-dialog');
function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    toast('设置未能保存。请检查设备存储空间或浏览器权限。');
  }
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4000);
}
function renderPreferences() {
  document.body.dataset.theme = ['glacier', 'amber', 'moon'].includes(preferences.theme)
    ? preferences.theme
    : 'glacier';
  document.body.classList.toggle('hide-seconds', !preferences.seconds);
  $('show-seconds').checked = preferences.seconds;
  $('keep-awake').checked = preferences.awake;
  $('city-label').textContent = preferences.city;
  $('city').value = preferences.city;
  document.querySelectorAll('.theme-option').forEach((button) => {
    const active = button.dataset.color === preferences.theme;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderBackgroundControls();
  renderProductSettings(preferences);
}
function renderBackgroundControls() {
  const landscape = preferences.background === 'landscape';
  document.body.dataset.background = preferences.background;
  document.body.style.setProperty('--background-dim', preferences.dim / 100);
  $('background-next').hidden = !landscape;
  $('landscape-settings').hidden = !landscape;
  $('rotate-background').checked = preferences.rotate;
  $('rotation-interval').value = preferences.interval;
  $('rotation-interval').disabled = !preferences.rotate;
  $('background-dim').value = preferences.dim;
  $('dim-value').textContent = `${preferences.dim}%`;
  document.querySelectorAll('.background-option').forEach((button) => {
    const active = button.dataset.background === preferences.background;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.scene-option').forEach((button) => {
    const active = button.dataset.scene === preferences.scene;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const index = scenes.findIndex((scene) => scene.id === preferences.scene);
  document.querySelector('.footer-center').textContent =
    landscape && activeLayer
      ? `${scenes[index].name} · ${String(index + 1).padStart(2, '0')} / 03`
      : 'MAKE ROOM FOR THE PRESENT.';
}
function scheduleRotation() {
  clearTimeout(rotationTimer);
  if (preferences.background === 'landscape' && preferences.rotate && !document.hidden) {
    rotationTimer = setTimeout(() => {
      if (document.querySelector('dialog[open]')) scheduleRotation();
      else nextScene();
    }, preferences.interval * 1000);
  }
}
async function showScene(id, feedback = false) {
  const scene = scenes.find((item) => item.id === id);
  const request = ++sceneRequest;
  clearTimeout(rotationTimer);
  // Decode before swapping layers, so a missing or slow image never blanks the clock.
  const preload = new Image();
  preload.src = scene.src;
  try {
    await preload.decode();
    if (request !== sceneRequest || preferences.background !== 'landscape') return;
    const layer = activeLayer === $('landscape-a') ? $('landscape-b') : $('landscape-a');
    layer.src = scene.src;
    await layer.decode();
    if (request !== sceneRequest || preferences.background !== 'landscape') return;
    layer.classList.add('visible');
    if (activeLayer) activeLayer.classList.remove('visible');
    activeLayer = layer;
    $('landscape-backdrop').classList.add('ready');
    preferences.scene = scene.id;
    renderBackgroundControls();
    save();
    if (feedback) toast(`已切换 · ${scene.name}`);
  } catch {
    if (request !== sceneRequest) return;
    if (!activeLayer) {
      preferences.background = 'solid';
      renderBackgroundControls();
    }
    toast('这张风景未能加载，已保留当前背景。');
  }
  if (request === sceneRequest) scheduleRotation();
}
function nextScene() {
  const index = scenes.findIndex((scene) => scene.id === preferences.scene);
  return showScene(scenes[(index + 1) % scenes.length].id);
}
function selectSettingsTab(tab) {
  ['display', 'background', 'weather', 'system'].forEach((name) => {
    const selected = name === tab;
    $(`${name}-tab`).setAttribute('aria-selected', String(selected));
    $(`${name}-tab`).tabIndex = selected ? 0 : -1;
    $(`${name}-panel`).hidden = !selected;
  });
}
const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const pad = (value) => String(value).padStart(2, '0');
function isoWeek(date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  return Math.ceil(((utc - new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
}
function updateClock() {
  const now = new Date();
  applyNight(preferences, now);
  const hours = pad(now.getHours()),
    minutes = pad(now.getMinutes()),
    seconds = pad(now.getSeconds());
  $('hours').textContent = hours;
  $('minutes').textContent = minutes;
  $('seconds').textContent = seconds;
  document
    .querySelector('.clock-face')
    .setAttribute('aria-label', `${hours}点${minutes}分${seconds}秒`);
  document.title = `${hours}:${minutes} · HORIZON`;
  $('seconds-progress').style.width = `${(now.getSeconds() / 59) * 100}%`;
  const progress = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 864;
  $('day-progress').style.width = `${progress}%`;
  $('day-marker').style.left = `${progress}%`;
  $('month-day').textContent = `${pad(now.getMonth() + 1)}月${pad(now.getDate())}日`;
  $('weekday').textContent = weekdays[now.getDay()];
  $('year').textContent = now.getFullYear();
  const day = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(now.getFullYear(), 0, 0)) /
      86400000
  );
  $('day-of-year').textContent = `第 ${pad(day)} 天`;
  $('week-number').textContent = `第 ${pad(isoWeek(now))} 周`;
  const offset = -now.getTimezoneOffset();
  $('timezone').textContent =
    `UTC${offset >= 0 ? '+' : '−'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  setTimeout(updateClock, 1000 - (Date.now() % 1000));
}
function updateWakeStatus(message) {
  const active = nativeAwake || (wakeLock && !wakeLock.released);
  $('wake-status').textContent = message || (active ? '屏幕常亮已开启' : '常亮待开启');
  document.querySelector('.display-status').classList.toggle('active', !!active);
}
async function requestWakeLock(showFeedback = false) {
  if (!preferences.awake) return;
  if (isDesktop) {
    try {
      nativeAwake = await native('set_keep_awake', { enabled: true });
      updateWakeStatus();
      if (showFeedback) toast('已请求系统保持唤醒，关闭应用后自动释放。');
    } catch {
      nativeAwake = false;
      updateWakeStatus('系统常亮请求未生效');
      if (showFeedback) toast('系统未能接受常亮请求，请检查桌面电源设置。');
    }
    return;
  }
  if (!('wakeLock' in navigator)) {
    updateWakeStatus('浏览器不支持常亮');
    $('wake-help').textContent = '当前浏览器不支持。正式部署需配置系统不休眠。';
    if (showFeedback) toast('此浏览器不支持屏幕常亮，请在系统中配置不休眠。');
    return;
  }
  if (wakeLock && !wakeLock.released) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () =>
      updateWakeStatus(preferences.awake ? '常亮已暂停' : '常亮待开启')
    );
    updateWakeStatus();
    if (showFeedback) toast('屏幕常亮已开启。请保持此页面在前台。');
  } catch {
    updateWakeStatus('常亮请求未生效');
    if (showFeedback) toast('未能开启常亮。请检查浏览器权限或系统电源设置。');
  }
}
async function toggleFullscreen() {
  try {
    if (isDesktop) {
      const active = await native('get_fullscreen');
      await native('set_fullscreen', { enabled: !active });
      $('fullscreen').setAttribute('aria-label', active ? '进入全屏' : '退出全屏');
      return;
    }
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    if (preferences.awake) await requestWakeLock();
  } catch {
    toast('此浏览器未能进入全屏，请使用浏览器的全屏功能。');
  }
}
function toggleNight() {
  const value = effectiveNight(preferences) < 0.5;
  if (preferences.autoNight)
    preferences.nightOverride = {
      value,
      until: nextNightBoundary(new Date(), preferences.nightStart, preferences.nightEnd),
    };
  else preferences.night = value;
  renderPreferences();
  save();
}
function openSettings() {
  document.body.classList.remove('immersive');
  dialog.showModal();
}
function resetIdle() {
  document.body.classList.remove('immersive');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (
      !document.querySelector('dialog[open]') &&
      !document.querySelector('.toolbar:focus-within') &&
      document.activeElement !== $('night-toggle')
    )
      document.body.classList.add('immersive');
  }, 8000);
}
$('fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  const active = !!document.fullscreenElement;
  $('fullscreen').setAttribute('aria-label', active ? '退出全屏' : '进入全屏');
  $('fullscreen').title = active ? '退出全屏 · F' : '全屏 · F';
});
$('settings-open').addEventListener('click', openSettings);
const settingsTabs = ['display', 'background', 'weather', 'system'];
settingsTabs.forEach((name) =>
  $(`${name}-tab`).addEventListener('click', () => selectSettingsTab(name))
);
document.querySelector('.settings-tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const current = settingsTabs.findIndex(
    (name) => $(`${name}-tab`).getAttribute('aria-selected') === 'true'
  );
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? settingsTabs.length - 1
        : (current + (event.key === 'ArrowLeft' ? -1 : 1) + settingsTabs.length) %
          settingsTabs.length;
  const tab = settingsTabs[index];
  selectSettingsTab(tab);
  $(`${tab}-tab`).focus();
});
document.querySelectorAll('.background-option').forEach((button) =>
  button.addEventListener('click', () => {
    ++sceneRequest;
    preferences.background = button.dataset.background;
    renderBackgroundControls();
    save();
    if (preferences.background === 'landscape') showScene(preferences.scene);
    else scheduleRotation();
  })
);
document
  .querySelectorAll('.scene-option')
  .forEach((button) => button.addEventListener('click', () => showScene(button.dataset.scene)));
$('background-next').addEventListener('click', () => {
  nextScene();
});
$('rotate-background').addEventListener('change', (event) => {
  preferences.rotate = event.target.checked;
  renderBackgroundControls();
  scheduleRotation();
  save();
});
$('rotation-interval').addEventListener('change', (event) => {
  preferences.interval = Number(event.target.value);
  scheduleRotation();
  save();
});
$('background-dim').addEventListener('input', (event) => {
  preferences.dim = Number(event.target.value);
  renderBackgroundControls();
  save();
});
$('settings-close').addEventListener('click', () => dialog.close());
$('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  dialog.close();
});
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
dialog.addEventListener('close', resetIdle);
document.querySelectorAll('.theme-option').forEach((button) =>
  button.addEventListener('click', () => {
    preferences.theme = button.dataset.color;
    renderPreferences();
    save();
  })
);
$('show-seconds').addEventListener('change', (event) => {
  preferences.seconds = event.target.checked;
  renderPreferences();
  save();
});
$('city').addEventListener('change', (event) => {
  preferences.city = event.target.value;
  renderPreferences();
  save();
  refreshWeather(true);
});
$('night-mode').addEventListener('change', toggleNight);
$('night-toggle').addEventListener('click', toggleNight);
$('keep-awake').addEventListener('change', async (event) => {
  preferences.awake = event.target.checked;
  save();
  if (preferences.awake) await requestWakeLock(true);
  else {
    if (isDesktop) {
      try {
        nativeAwake = await native('set_keep_awake', { enabled: false });
      } catch {
        toast('未能确认系统常亮已关闭，请退出应用以释放。');
      }
    } else if (wakeLock && !wakeLock.released) await wakeLock.release();
    updateWakeStatus();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && preferences.awake) requestWakeLock();
  scheduleRotation();
});
document.addEventListener('keydown', (event) => {
  resetIdle();
  if (
    document.querySelector('dialog[open]') ||
    /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return;
  if (event.key === 'Escape' && isDesktop)
    native('set_fullscreen', { enabled: false }).catch(() => toast('未能退出全屏。'));
  if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    toggleFullscreen();
  }
  if (event.key.toLowerCase() === 'n') toggleNight();
  if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    openSettings();
  }
  if (event.key.toLowerCase() === 'b' && preferences.background === 'landscape') nextScene();
});
['pointermove', 'pointerdown', 'focusin'].forEach((event) =>
  document.addEventListener(event, resetIdle, { passive: true })
);
renderPreferences();
initializeProduct({
  getSettings: () => preferences,
  replaceSettings: (value) => {
    preferences = value;
  },
  render: renderPreferences,
  save,
  toast,
  showScene,
  scheduleRotation,
  requestWakeLock,
});
if (preferences.background === 'landscape') showScene(preferences.scene);
updateClock();
if (preferences.awake) requestWakeLock();
resetIdle();
