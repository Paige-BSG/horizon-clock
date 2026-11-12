import { calendarDay, localDate } from './china-calendar.js';

export const ALARM_LIMIT = 20;
export const REPEATS = Object.freeze({
  once: '仅一次',
  daily: '每天',
  workday: '工作日（含调休）',
  holiday: '假日（含周末）',
  weekly: '自选星期',
});
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function validDate(value) {
  return (
    typeof value === 'string' &&
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    localDate(new Date(`${value}T12:00:00`)) === value
  );
}
export function normalizeAlarms(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const result = [];
  for (const value of input.slice(0, ALARM_LIMIT)) {
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,64}$/.test(value.id) ||
      seen.has(value.id) ||
      typeof value.time !== 'string' ||
      !timePattern.test(value.time) ||
      typeof value.repeat !== 'string' ||
      !Object.hasOwn(REPEATS, value.repeat)
    )
      continue;
    const weekdays = Array.isArray(value.weekdays)
      ? [
          ...new Set(value.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)),
        ].sort()
      : [];
    if (value.repeat === 'weekly' && !weekdays.length) continue;
    if (value.repeat === 'once' && !validDate(value.date)) continue;
    seen.add(value.id);
    result.push({
      id: value.id,
      time: value.time,
      label: typeof value.label === 'string' ? value.label.trim().slice(0, 40) : '',
      enabled: value.enabled === true,
      repeat: value.repeat,
      weekdays,
      date: validDate(value.date) ? value.date : '',
    });
  }
  return result;
}

export function nextOccurrence(alarm, after = new Date()) {
  if (!alarm.enabled) return null;
  const [hours, minutes] = alarm.time.split(':').map(Number);
  const day = new Date(after);
  day.setHours(12, 0, 0, 0);
  for (let offset = 0; offset < 370; offset++, day.setDate(day.getDate() + 1)) {
    const candidate = new Date(day);
    candidate.setHours(hours, minutes, 0, 0);
    // A nonexistent local time during a DST transition does not move the alarm.
    if (candidate <= after || candidate.getHours() !== hours || candidate.getMinutes() !== minutes)
      continue;
    if (alarm.repeat === 'once') {
      if (localDate(candidate) === alarm.date) return candidate;
      if (localDate(candidate) > alarm.date) return null;
    } else if (
      alarm.repeat === 'daily' ||
      (alarm.repeat === 'weekly' && alarm.weekdays.includes(candidate.getDay())) ||
      (['workday', 'holiday'].includes(alarm.repeat) && calendarDay(candidate) === alarm.repeat)
    )
      return candidate;
  }
  return null;
}

// Supply a month of occurrences so a throttled webview cannot delay native ringing.
export function alarmSchedule(alarms, now = new Date()) {
  const end = new Date(now);
  end.setDate(end.getDate() + 35);
  return alarms
    .flatMap((alarm) => {
      const occurrences = [];
      let after = now;
      for (let i = 0; i < 35; i++) {
        const next = nextOccurrence(alarm, after);
        if (!next || next > end) break;
        occurrences.push({ alarmId: alarm.id, at: next.getTime(), label: alarm.label || '闹钟' });
        after = next;
      }
      return occurrences;
    })
    .sort((a, b) => a.at - b.at);
}
