import { VERSION, importSettings, exportSettings } from './settings.js';
import { effectiveNight, displayLevels } from './night.js';
import {
  weatherUrl,
  weatherPlaceKey,
  parseWeather,
  validCache,
  weatherDescription,
  WEATHER_TTL,
} from './weather.js';
import { isDesktop, native } from './desktop.js';
import { systemLocation, readLocation, LocationError, LOCATION_KEY } from './location.js';

const $ = (id) => document.getElementById(id);
let context;
let weatherData = null;
let weatherTimer;
let weatherRequest;
let weatherGeneration = 0;
let weatherState = 'disabled';
let weatherPlace = null;
let locationError = '';
const selectedPlace = () =>
  context.getSettings().city === '自动定位' ? weatherPlace : context.getSettings().city;

export function applyNight(settings, date = new Date()) {
  const preview = document.body.dataset.previewPeriod;
  const strength = preview === 'day' ? 0 : preview === 'night' ? 1 : effectiveNight(settings, date);
  const levels = displayLevels(settings, strength);
  document.body.classList.toggle('night', strength > 0);
  document.body.style.setProperty('--display-brightness', levels.brightness);
  document.body.style.setProperty('--scene-brightness', 1);
  document.body.style.setProperty('--background-dim', levels.dim);
  const active = strength >= 0.5;
  $('night-mode').checked = active;
}

export function renderProductSettings(settings) {
  $('auto-night').checked = settings.autoNight;
  $('night-start').value = settings.nightStart;
  $('night-end').value = settings.nightEnd;
  $('night-schedule').hidden = !settings.autoNight;
  $('night-schedule-help').textContent =
    settings.autoNight && settings.nightOverride?.until > Date.now()
      ? '手动调整至下次昼夜切换'
      : '20 分钟渐变';
  $('weather-enabled').checked = settings.weatherEnabled;
  $('weather-refresh').disabled = !settings.weatherEnabled;
  $('fullscreen-start').checked = settings.fullscreenOnStart;
  $('fullscreen-start').disabled = !isDesktop;
  $('desktop-help').textContent = isDesktop ? '' : '仅桌面版可用';
  $('wake-help').textContent = isDesktop ? '退出应用后释放' : '仅在页面前台生效';
  $('app-version').textContent = VERSION;
  applyNight(settings);
  renderWeather();
}

function renderWeather() {
  if (!context) return;
  const settings = context.getSettings();
  const data =
    settings.weatherEnabled && validCache(weatherData, selectedPlace()) ? weatherData : null;
  $('city-label').textContent =
    settings.city === '自动定位'
      ? (locationError || weatherState === 'locating') && data
        ? '上次位置'
        : '当前位置'
      : settings.city;
  $('temperature-value').textContent = data?.temperature ?? '--';
  $('weather-high').textContent = `${data?.high ?? '--'}°`;
  $('weather-low').textContent = `${data?.low ?? '--'}°`;
  $('weather-humidity').textContent = data?.humidity ?? '--';
  $('weather-wind').textContent = data?.wind ?? '--';
  $('weather-direction').textContent = data?.direction ?? '风速';
  $('weather-description').textContent = data
    ? weatherDescription(data.code, data.isDay)
    : !settings.weatherEnabled
      ? '天气未启用'
      : weatherState === 'locating'
        ? '正在定位'
        : locationError || (weatherState === 'loading' ? '正在更新' : '暂不可用');
  $('weather-sun').toggleAttribute('hidden', !data || !data.isDay || data.code > 2);
  $('weather-rain').toggleAttribute(
    'hidden',
    !data || ![51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(data.code)
  );
  $('weather-snow').toggleAttribute(
    'hidden',
    !data || ![71, 73, 75, 77, 85, 86].includes(data.code)
  );
  const stale = data && (weatherState !== 'fresh' || Date.now() - data.fetchedAt > WEATHER_TTL * 2);
  const time = data
    ? new Date(data.fetchedAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '';
  $('weather-status').textContent = !settings.weatherEnabled
    ? '未启用'
    : data
      ? `${stale ? '缓存' : '更新'} ${time}`
      : weatherState === 'locating'
        ? '定位中'
        : locationError || (weatherState === 'loading' ? '更新中' : '离线');
  $('weather-status').classList.toggle('stale', !!stale);
  $('weather-status').title = data
    ? `Open-Meteo 模型数据；获取于 ${new Date(data.fetchedAt).toLocaleString('zh-CN')}。${stale ? '目前显示缓存，等待下次更新。' : ''}`
    : '可在设置的天气页启用或重新获取天气。';
  $('weather-detail-status').textContent = !settings.weatherEnabled
    ? '天气尚未启用。'
    : data
      ? `${stale ? '正在使用最近缓存' : '已更新'} · ${time} · ${settings.city === '自动定位' ? (locationError || weatherState === 'locating' ? '上次位置' : '当前位置') : settings.city}${locationError ? ' · ' + locationError : ''}`
      : weatherState === 'locating'
        ? '正在获取系统位置…'
        : locationError
          ? `${locationError}，可重试或手动选择城市。`
          : weatherState === 'loading'
            ? '正在连接天气服务…'
            : '天气暂不可用。';
}

function loadWeatherCache(place) {
  if (validCache(weatherData, place)) return;
  try {
    const cached = JSON.parse(localStorage.getItem(`horizon-weather-v1:${weatherPlaceKey(place)}`));
    weatherData = validCache(cached, place) ? cached : null;
  } catch {
    weatherData = null;
  }
}

export async function refreshWeather(force = false) {
  if (!context) return;
  clearTimeout(weatherTimer);
  const generation = ++weatherGeneration;
  weatherRequest?.abort();
  const { city, weatherEnabled } = context.getSettings();
  locationError = '';
  if (!weatherEnabled) {
    weatherData = null;
    weatherState = 'disabled';
    renderWeather();
    return;
  }
  const controller = new AbortController();
  weatherRequest = controller;
  let timeout;
  try {
    if (city === '自动定位') {
      weatherPlace ||= readLocation(localStorage);
      loadWeatherCache(weatherPlace);
      weatherState = 'locating';
      renderWeather();
      const location = await systemLocation(controller.signal);
      if (generation !== weatherGeneration) return;
      weatherPlace = location;
      try {
        localStorage.setItem(
          LOCATION_KEY,
          JSON.stringify({ ...weatherPlace, fetchedAt: Date.now() })
        );
      } catch {
        /* Location can still be used in memory. */
      }
    }
    const place = selectedPlace();
    loadWeatherCache(place);
    if (!force && weatherData && Date.now() - weatherData.fetchedAt < WEATHER_TTL) {
      weatherState = 'cached';
      return;
    }
    weatherState = 'loading';
    renderWeather();
    timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(weatherUrl(place), {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error('Weather service unavailable');
    const data = parseWeather(await response.json(), place);
    if (generation !== weatherGeneration) return;
    weatherData = data;
    weatherState = 'fresh';
    try {
      localStorage.setItem(`horizon-weather-v1:${weatherPlaceKey(place)}`, JSON.stringify(data));
    } catch {
      /* In-memory weather still works when storage is full. */
    }
  } catch (error) {
    if (generation !== weatherGeneration) return;
    if (error instanceof LocationError) locationError = error.message;
    weatherState = 'unavailable';
    if (!validCache(weatherData, selectedPlace())) weatherData = null;
  } finally {
    clearTimeout(timeout);
    if (generation === weatherGeneration) {
      renderWeather();
      if (!document.hidden) weatherTimer = setTimeout(() => refreshWeather(true), WEATHER_TTL);
    }
  }
}

async function checkUpdates() {
  const button = $('check-updates');
  button.disabled = true;
  $('update-status').textContent = '正在检查 GitHub 正式发行版…';
  try {
    const response = await fetch(
      'https://api.github.com/repos/Paige-BSG/horizon-clock/releases/latest',
      { signal: AbortSignal.timeout(10000), credentials: 'omit', referrerPolicy: 'no-referrer' }
    );
    if (response.status === 404) {
      $('update-status').textContent = '目前尚无正式发行版。你正在使用开发预览版。';
      return;
    }
    if (!response.ok) throw new Error('Update request failed');
    const release = await response.json();
    if (
      typeof release.tag_name !== 'string' ||
      !/^v?\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(release.tag_name)
    )
      throw new Error('Invalid release');
    // Checking metadata never downloads or executes an update.
    $('update-status').textContent =
      `当前 ${VERSION} · 最新正式发行版 ${release.tag_name}。安装说明见项目 GitHub Releases 页面。`;
  } catch {
    $('update-status').textContent = '暂时无法检查更新。当前版本可以继续使用。';
  } finally {
    button.disabled = false;
  }
}

export function initializeProduct(options) {
  context = options;
  const get = options.getSettings;
  const persist = () => {
    options.render();
    options.save();
  };
  $('auto-night').addEventListener('change', (event) => {
    get().autoNight = event.target.checked;
    get().nightOverride = null;
    persist();
  });
  for (const [id, key] of [
    ['night-start', 'nightStart'],
    ['night-end', 'nightEnd'],
  ]) {
    $(id).addEventListener('change', (event) => {
      const value = event.target.value;
      if (
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ||
        value === get()[key === 'nightStart' ? 'nightEnd' : 'nightStart']
      ) {
        options.toast('开始与恢复时间需不同，且必须是有效时间。');
        options.render();
        return;
      }
      get()[key] = value;
      get().nightOverride = null;
      persist();
    });
  }
  $('weather-enabled').addEventListener('change', (event) => {
    get().weatherEnabled = event.target.checked;
    persist();
    refreshWeather(true);
  });
  $('weather-refresh').addEventListener('click', () => refreshWeather(true));
  $('fullscreen-start').addEventListener('change', (event) => {
    get().fullscreenOnStart = event.target.checked;
    options.save();
  });
  $('autostart').addEventListener('change', async (event) => {
    const requested = event.target.checked;
    event.target.disabled = true;
    try {
      event.target.checked = await native('set_autostart', { enabled: requested });
    } catch {
      event.target.checked = !requested;
      options.toast('自启动设置未能保存，请检查系统权限。');
    } finally {
      event.target.disabled = false;
    }
  });
  if (isDesktop) {
    native('get_autostart')
      .then((active) => {
        $('autostart').checked = active;
        $('autostart').disabled = false;
      })
      .catch(() => {
        $('desktop-help').textContent = '无法读取自启动状态，请检查系统权限。';
      });
    if (get().fullscreenOnStart)
      native('set_fullscreen', { enabled: true })
        .then(() => $('fullscreen').setAttribute('aria-label', '退出全屏'))
        .catch(() => options.toast('自动全屏未能开启，可手动点击全屏按钮。'));
  }
  $('export-settings').addEventListener('click', () => {
    const url = URL.createObjectURL(
      new Blob([exportSettings(get())], { type: 'application/json' })
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'horizon-settings.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  $('import-settings').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 65536) throw new Error('设置文件过大。');
      options.replaceSettings(importSettings(await file.text(), get()));
      persist();
      options.refreshBackgrounds();
      refreshWeather(true);
      options.toast('设置已导入。');
    } catch {
      options.toast('未能导入。请选择 HORIZON 导出的有效设置文件。');
    } finally {
      event.target.value = '';
    }
  });
  $('check-updates').addEventListener('click', checkUpdates);
  refreshWeather(true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(weatherTimer);
      ++weatherGeneration;
      weatherRequest?.abort();
    } else refreshWeather();
  });
  window.addEventListener('online', () => refreshWeather(true));
  window.addEventListener('offline', () => {
    weatherState = 'unavailable';
    renderWeather();
  });
}
