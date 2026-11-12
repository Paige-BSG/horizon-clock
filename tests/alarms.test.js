import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDay } from '../lib/china-calendar.js';
import { normalizeAlarms, nextOccurrence, alarmSchedule } from '../lib/alarm-model.js';

const local = (day, time = '06:59') => new Date(`${day}T${time}:00`);
const alarm = (repeat = 'workday', extra = {}) => ({
  id: 'morning',
  time: '07:00',
  label: '起床',
  enabled: true,
  repeat,
  weekdays: [1, 2, 3, 4, 5],
  ...extra,
});

test('mainland calendar distinguishes holidays, ordinary weekends and makeup workdays', () => {
  for (const day of [
    '2026-01-04',
    '2026-02-14',
    '2026-02-28',
    '2026-05-09',
    '2026-09-20',
    '2026-10-10',
    '2027-01-31',
    '2027-02-14',
    '2027-05-08',
    '2027-09-26',
    '2027-10-09',
  ])
    assert.equal(calendarDay(local(day)), 'workday', day);
  for (const day of [
    '2026-01-01',
    '2026-02-23',
    '2026-04-06',
    '2026-05-05',
    '2026-06-19',
    '2026-09-25',
    '2026-10-07',
    '2027-02-12',
    '2027-06-09',
    '2027-09-15',
    '2027-10-07',
    '2026-11-14',
  ])
    assert.equal(calendarDay(local(day)), 'holiday', day);
  assert.equal(calendarDay(local('2026-11-12')), 'workday');
  assert.equal(calendarDay(local('2028-01-01')), 'unknown');
});

test('workday and holiday alarms follow official overrides, including across years', () => {
  assert.equal(nextOccurrence(alarm(), local('2026-01-03')).getDate(), 4);
  assert.equal(nextOccurrence(alarm('holiday'), local('2026-01-04')).getDate(), 10);
  assert.equal(nextOccurrence(alarm(), local('2026-02-15')).getDate(), 24);
  assert.equal(nextOccurrence(alarm('holiday'), local('2026-12-31', '08:00')).getFullYear(), 2027);
  assert.equal(nextOccurrence(alarm(), local('2028-01-01')), null);
});

test('daily, once and custom weekdays use local time and skip elapsed occurrences', () => {
  assert.equal(nextOccurrence(alarm('daily'), local('2026-11-12', '07:00')).getDate(), 13);
  assert.equal(
    nextOccurrence(alarm('once', { date: '2026-11-13' }), local('2026-11-12')).getDate(),
    13
  );
  assert.equal(nextOccurrence(alarm('once', { date: '2026-11-11' }), local('2026-11-12')), null);
  assert.equal(nextOccurrence(alarm('weekly', { weekdays: [0] }), local('2026-11-12')).getDay(), 0);
  assert.equal(nextOccurrence(alarm('daily', { enabled: false }), local('2026-11-12')), null);
  assert.equal(nextOccurrence(alarm('daily'), local('2028-01-01')).getFullYear(), 2028);
});

test('malformed alarms cannot produce schedules or duplicate native IDs', () => {
  const values = normalizeAlarms([
    alarm(),
    alarm(),
    alarm('bad', { id: 'bad' }),
    alarm('daily', { id: 'late', time: '25:00' }),
    null,
  ]);
  assert.equal(values.length, 1);
  assert.deepEqual(normalizeAlarms({}), []);
  assert.equal(normalizeAlarms([alarm('weekly', { weekdays: [] })]).length, 0);
  assert.equal(normalizeAlarms([alarm('once', { date: '2026-02-30' })]).length, 0);
  const schedule = alarmSchedule(values, local('2026-11-12'));
  assert.equal(schedule[0].alarmId, 'morning');
  assert.equal(schedule[0].at, local('2026-11-12', '07:00').getTime());
});
