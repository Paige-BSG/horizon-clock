import { createBackgrounds } from './lib/backgrounds.js';
import { SETTINGS_KEY as storageKey, readSettings } from './lib/settings.js';
import { isDesktop, native } from './lib/desktop.js';
import { initializeViewport } from './lib/viewport.js';
import { initializeMusic } from './lib/music.js';
import { effectiveNight, nextNightBoundary } from './lib/night.js';
import {
  initializeProduct,
  renderProductSettings,
  applyNight,
  refreshWeather,
} from './lib/product.js';

const $ = (id) => document.getElementById(id);
initializeViewport(isDesktop);
let preferences = readSettings({ getItem: (key) => localStorage.getItem(key) });
let wakeLock = null;
let nativeAwake = false;
let toastTimer;
let idleTimer;
const dialog = $('settings-dialog');
const music = initializeMusic({ toast, resetIdle });
const backgrounds = createBackgrounds({
  getSettings: () => preferences,
  save,
  toast,
  applyNight: () => applyNight(preferences),
  openAdvanced: () => openSettings('background'),
});
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
  backgrounds.renderControls();
}
function selectSettingsTab(tab) {
  ['display', 'background', 'weather', 'system'].forEach((name) => {
    const selected = name === tab;
    $(`${name}-tab`).setAttribute('aria-selected', String(selected));
    $(`${name}-tab`).tabIndex = selected ? 0 : -1;
    $(`${name}-panel`).hidden = !selected;
  });
  backgrounds.renderControls();
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
  backgrounds.syncDisplay();
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
function openSettings(tab) {
  document.body.classList.remove('immersive');
  if (typeof tab === 'string') selectSettingsTab(tab);
  dialog.showModal();
}
function resetIdle() {
  document.body.classList.remove('immersive');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (
      !document.querySelector('dialog[open]') &&
      !document.querySelector('.toolbar :focus-visible') &&
      !document.querySelector('#music-panel :focus-visible') &&
      !$('night-toggle').matches(':focus-visible')
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
$('settings-close').addEventListener('click', () => dialog.close());
$('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  dialog.close();
});
for (const modal of [dialog, $('background-picker'), $('photo-source-dialog')])
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      const r = modal.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        modal.close();
    }
  });
dialog.addEventListener('close', resetIdle);
$('background-picker').addEventListener('close', resetIdle);
$('photo-source-dialog').addEventListener('close', resetIdle);
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
  backgrounds.scheduleRotation();
});
document.addEventListener('keydown', (event) => {
  resetIdle();
  if (document.querySelector('dialog[open]') || event.metaKey || event.ctrlKey || event.altKey)
    return;
  if (event.key === 'Escape' && music.isOpen()) {
    music.toggle(false);
    return;
  }
  if (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  if (event.key === 'Escape' && isDesktop)
    native('set_fullscreen', { enabled: false })
      .then(() => $('fullscreen').setAttribute('aria-label', '进入全屏'))
      .catch(() => toast('未能退出全屏。'));
  if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    toggleFullscreen();
  }
  if (event.key.toLowerCase() === 'n') toggleNight();
  if (event.key.toLowerCase() === 'm') {
    event.preventDefault();
    music.toggle();
  }
  if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    openSettings();
  }
  if (event.key.toLowerCase() === 'b' && document.body.dataset.background === 'landscape')
    backgrounds.nextScene();
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
  refreshBackgrounds: backgrounds.refresh,
  requestWakeLock,
});
backgrounds.syncDisplay(true);
updateClock();
if (preferences.awake) requestWakeLock();
resetIdle();
