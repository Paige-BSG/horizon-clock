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
