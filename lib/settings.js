export const SETTINGS_KEY = 'horizon-display-v1';
export const VERSION = '0.1.0-alpha.1';
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
  city: '东京',
  awake: false,
  background: 'landscape',
  scene: 'lake',
  rotate: true,
  interval: 60,
  dim: 45,
  autoNight: false,
  nightStart: '22:00',
  nightEnd: '07:00',
  nightOverride: null,
  weatherEnabled: false,
  fullscreenOnStart: true,
  onboarded: false,
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
    'fullscreenOnStart',
    'onboarded',
  ]) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  for (const [key, options] of Object.entries({
    theme: ['glacier', 'amber', 'moon'],
    background: ['solid', 'landscape'],
    scene: ['lake', 'mountain', 'coast'],
    city: Object.keys(CITIES),
  })) {
    if (options.includes(input[key])) result[key] = input[key];
  }
  if ([30, 60, 300, 900].includes(input.interval)) result.interval = input.interval;
  if (typeof input.dim === 'number' && Number.isFinite(input.dim))
    result.dim = Math.round(Math.min(75, Math.max(35, input.dim)));
  for (const key of ['nightStart', 'nightEnd'])
    if (timePattern.test(input[key])) result[key] = input[key];
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
  for (const key of ['awake', 'weatherEnabled', 'nightOverride', 'onboarded']) delete safe[key];
  return JSON.stringify({ app: 'horizon-clock', schemaVersion: 1, settings: safe }, null, 2);
}
export function importSettings(text, current) {
  if (text.length > 65536) throw new Error('设置文件过大。');
  const data = JSON.parse(text);
  if (
    data?.app !== 'horizon-clock' ||
    data.schemaVersion !== 1 ||
    !data.settings ||
    typeof data.settings !== 'object' ||
    Array.isArray(data.settings)
  )
    throw new Error('请选择 HORIZON 导出的设置文件。');
  const restored = normalizeSettings(data.settings);
  for (const key of ['awake', 'weatherEnabled', 'nightOverride', 'onboarded'])
    restored[key] = current[key];
  return restored;
}
