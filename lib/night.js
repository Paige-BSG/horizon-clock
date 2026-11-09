const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export function nightStrength(date, start, end, fade = 20) {
  const first = minutes(start),
    last = minutes(end);
  const duration = (last - first + 1440) % 1440;
  if (!duration) return 0;
  const current = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  const elapsed = (current - first + 1440) % 1440;
  if (elapsed >= duration) return 0;
  const ramp = Math.min(Math.max(fade, 0), duration / 2);
  return ramp ? Math.min(1, elapsed / ramp, (duration - elapsed) / ramp) : 1;
}
export function nextNightBoundary(date, start, end) {
  const candidates = [];
  for (const time of [start, end]) {
    const next = new Date(date);
    next.setHours(Number(time.slice(0, 2)), Number(time.slice(3)), 0, 0);
    if (next <= date) next.setDate(next.getDate() + 1);
    candidates.push(next.getTime());
  }
  return Math.min(...candidates);
}
export function effectiveNight(settings, date = new Date()) {
  if (!settings.autoNight) return settings.night ? 1 : 0;
  if (settings.nightOverride?.until > date.getTime()) return settings.nightOverride.value ? 1 : 0;
  return nightStrength(date, settings.nightStart, settings.nightEnd);
}

export function displayProfile(settings, period) {
  return period === 'night'
    ? {
        background: settings.nightBackground,
        scene: settings.nightScene,
        collection: settings.nightCollection,
        dim: settings.nightDim,
        brightness: settings.nightBrightness,
      }
    : {
        background: settings.background,
        scene: settings.scene,
        collection: settings.collection,
        dim: settings.dim,
        brightness: settings.dayBrightness,
      };
}

export function setDisplayProfile(settings, period, patch) {
  const names =
    period === 'night'
      ? {
          background: 'nightBackground',
          scene: 'nightScene',
          collection: 'nightCollection',
          dim: 'nightDim',
          brightness: 'nightBrightness',
        }
      : {
          background: 'background',
          scene: 'scene',
          collection: 'collection',
          dim: 'dim',
          brightness: 'dayBrightness',
        };
  for (const [key, value] of Object.entries(patch)) if (names[key]) settings[names[key]] = value;
}

export function displayLevels(settings, strength) {
  const fraction = Math.min(1, Math.max(0, strength));
  return {
    brightness:
      (settings.dayBrightness + (settings.nightBrightness - settings.dayBrightness) * fraction) /
      100,
    dim: (settings.dim + (settings.nightDim - settings.dim) * fraction) / 100,
  };
}
