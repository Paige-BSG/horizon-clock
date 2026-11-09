import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  normalizeSettings,
  readSettings,
  exportSettings,
  importSettings,
} from '../lib/settings.js';

test('corrupt and unavailable storage recover to validated defaults', () => {
  for (const input of [
    null,
    [],
    123,
    'broken',
    {
      dim: Infinity,
      city: 'constructor',
      interval: 1,
      seconds: 'false',
      theme: '<script>',
      nightStart: '25:00',
    },
  ])
    assert.deepEqual(normalizeSettings(input), DEFAULTS);
  assert.deepEqual(readSettings({ getItem: () => '{broken' }), DEFAULTS);
  assert.deepEqual(
    readSettings({
      getItem: () => {
        throw Error('Denied');
      },
    }),
    DEFAULTS
  );
});
test('old prototype preferences migrate without losing the accepted appearance', () => {
  const migrated = normalizeSettings({
    theme: 'amber',
    city: '上海',
    background: 'solid',
    dim: 63,
    night: true,
  });
  assert.equal(migrated.theme, 'amber');
  assert.equal(migrated.dim, 63);
  assert.equal(migrated.background, 'solid');
  assert.equal(migrated.city, '上海');
  assert.equal(migrated.weatherEnabled, false);
  assert.equal(migrated.autoNight, false);
});
test('night times and numeric limits normalize; unknown keys cannot cross the boundary', () => {
  const value = normalizeSettings(
    JSON.parse(
      '{"__proto__":{"polluted":true},"dim":999,"nightStart":"07:00","nightEnd":"07:00","token":"private"}'
    )
  );
  assert.equal(value.dim, 75);
  assert.equal(value.nightStart, '22:00');
  assert.equal(value.token, undefined);
  assert.equal({}.polluted, undefined);
});
test('backup roundtrip keeps machine integration and network consent on this device', () => {
  const source = normalizeSettings({
    theme: 'moon',
    city: '上海',
    awake: true,
    weatherEnabled: true,
    seconds: false,
  });
  const current = normalizeSettings({ onboarded: true });
  const backup = exportSettings(source),
    result = importSettings(backup, current);
  assert.equal(result.theme, 'moon');
  assert.equal(result.city, '上海');
  assert.equal(result.seconds, false);
  assert.equal(result.awake, false);
  assert.equal(result.weatherEnabled, false);
  assert.equal(result.onboarded, true);
  assert.equal(JSON.parse(backup).settings.awake, undefined);
  for (const value of [
    '{}',
    'null',
    '[]',
    '{"app":"horizon-clock","schemaVersion":2,"settings":{}}',
  ])
    assert.throws(() => importSettings(value, current));
  assert.throws(() => importSettings(' '.repeat(65537), current));
});
