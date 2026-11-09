import test from 'node:test';
import assert from 'node:assert/strict';
import { nightStrength, nextNightBoundary, effectiveNight } from '../lib/night.js';
import { normalizeSettings } from '../lib/settings.js';
const at = (time) => new Date(`2026-11-09T${time}:00`);
test('overnight schedule ramps at both edges without changing the device clock', () => {
  for (const [time, strength] of [
    ['21:59', 0],
    ['22:00', 0],
    ['22:10', 0.5],
    ['22:20', 1],
    ['00:00', 1],
    ['06:40', 1],
    ['06:50', 0.5],
    ['07:00', 0],
    ['12:00', 0],
  ])
    assert.equal(nightStrength(at(time), '22:00', '07:00'), strength, time);
});
test('same-day and short schedules stay within brightness limits', () => {
  assert.equal(nightStrength(at('12:00'), '10:00', '14:00'), 1);
  assert.equal(nightStrength(at('12:00'), '14:00', '14:00'), 0);
  assert.equal(nightStrength(at('22:05'), '22:00', '22:10'), 1);
});
test('manual override expires at the next local boundary', () => {
  const settings = normalizeSettings({
    autoNight: true,
    nightOverride: { value: false, until: at('07:00').getTime() },
  });
  assert.equal(effectiveNight(settings, at('06:00')), 0);
  assert.equal(effectiveNight(settings, at('23:00')), 1);
  assert.equal(new Date(nextNightBoundary(at('06:00'), '22:00', '07:00')).getHours(), 7);
  assert.equal(new Date(nextNightBoundary(at('23:00'), '22:00', '07:00')).getDate(), 10);
});
