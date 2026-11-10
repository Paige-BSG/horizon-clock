import { BUILTIN_SCENES } from './scenes.js';
export const SETTINGS_KEY = 'horizon-display-v1';
export const VERSION = '0.2.0-alpha.3';
export const CITIES = Object.freeze({
  东京: { latitude: 35.68, longitude: 139.69 },
  上海: { latitude: 31.23, longitude: 121.47 },
  北京: { latitude: 39.9, longitude: 116.41 },
  深圳: { latitude: 22.54, longitude: 114.06 },
  杭州: { latitude: 30.27, longitude: 120.15 },
});
export const DEFAULTS = Object.freeze({
  theme: 'glacier',
  seconds: true,
  night: false,
  city: '自动定位',
  awake: false,
  background: 'landscape',
  scene: 'lake',
  rotate: true,
  interval: 60,
  dim: 45,
  collection: 'builtin',
  dayBrightness: 100,
  nightBrightness: 42,
  nightDim: 81,
  nightBackground: 'landscape',
  nightScene: 'lake',
  nightCollection: 'builtin',
  autoNight: true,
  nightStart: '22:00',
  nightEnd: '07:00',
  nightOverride: null,
  weatherEnabled: true,
  onlineEnabled: false,
  fullscreenOnStart: true,
});
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function normalizeSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const result = { ...DEFAULTS };
  for (const key of [
    'seconds',
    'night',
    'awake',
    'rotate',
    'autoNight',
    'weatherEnabled',
    'onlineEnabled',
    'fullscreenOnStart',
  ]) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  for (const [key, options] of Object.entries({
    theme: ['glacier', 'amber', 'moon'],
    background: ['solid', 'landscape'],
    scene: ['lake', 'mountain', 'coast'],
    city: ['自动定位', ...Object.keys(CITIES)],
    collection: ['builtin', 'personal'],
    nightCollection: ['builtin', 'personal'],
    nightBackground: ['solid', 'landscape'],
  })) {
    if (options.includes(input[key])) result[key] = input[key];
  }
  if ([30, 60, 300, 900].includes(input.interval)) result.interval = input.interval;
  if (typeof input.dim === 'number' && Number.isFinite(input.dim))
    result.dim = Math.round(Math.min(75, Math.max(35, input.dim)));
  for (const [key, low, high] of [
    ['dayBrightness', 30, 100],
    ['nightBrightness', 10, 100],
    ['nightDim', 35, 95],
  ]) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key]))
      result[key] = Math.round(Math.min(high, Math.max(low, input[key])));
  }
  for (const key of ['scene', 'nightScene']) {
    if (
      BUILTIN_SCENES.some((scene) => scene.id === input[key]) ||
      (typeof input[key] === 'string' && /^commons:[1-9]\d{0,14}$/.test(input[key])) ||
      (typeof input[key] === 'string' && /^photo:[a-f0-9]{64}$/.test(input[key]))
    )
      result[key] = input[key];
  }
  // Migrate existing designs without changing their chosen night background.
  if (!Object.hasOwn(input, 'nightBackground')) result.nightBackground = result.background;
  if (!Object.hasOwn(input, 'nightScene')) result.nightScene = result.scene;
  if (!Object.hasOwn(input, 'nightCollection')) result.nightCollection = result.collection;
  if (!Object.hasOwn(input, 'nightDim'))
    result.nightDim = Math.round(100 - (100 - result.dim) * 0.35);
  for (const key of ['nightStart', 'nightEnd'])
    if (typeof input[key] === 'string' && timePattern.test(input[key])) result[key] = input[key];
  if (result.nightStart === result.nightEnd) {
    result.nightStart = DEFAULTS.nightStart;
    result.nightEnd = DEFAULTS.nightEnd;
  }
  const override = input.nightOverride;
  if (override && typeof override.value === 'boolean' && Number.isFinite(override.until))
    result.nightOverride = { value: override.value, until: override.until };
  return result;
}
export function readSettings(storage) {
  try {
    return normalizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY)));
  } catch {
    return normalizeSettings();
  }
}
export function exportSettings(settings) {
  const safe = normalizeSettings(settings);
  // Machine integration and network consent are intentionally not portable.
  for (const key of ['awake', 'weatherEnabled', 'onlineEnabled', 'nightOverride']) delete safe[key];
  return JSON.stringify({ app: 'horizon-clock', schemaVersion: 2, settings: safe }, null, 2);
}
export function importSettings(text, current) {
  if (text.length > 65536) throw new Error('设置文件过大。');
  const data = JSON.parse(text);
  if (
    data?.app !== 'horizon-clock' ||
    ![1, 2].includes(data.schemaVersion) ||
    !data.settings ||
    typeof data.settings !== 'object' ||
    Array.isArray(data.settings)
  )
    throw new Error('请选择 HORIZON 导出的设置文件。');
  const restored = normalizeSettings(data.settings);
  for (const key of ['awake', 'weatherEnabled', 'onlineEnabled', 'nightOverride'])
    restored[key] = current[key];
  return restored;
}
