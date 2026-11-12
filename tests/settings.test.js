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

test('v1 backups migrate to independent night settings and current backups roundtrip them', () => {
  const old = importSettings(
    JSON.stringify({
      app: 'horizon-clock',
      schemaVersion: 1,
      settings: { background: 'solid', scene: 'coast', dim: 55 },
    }),
    normalizeSettings()
  );
  assert.equal(old.nightBackground, 'solid');
  assert.equal(old.nightScene, 'coast');
  assert.equal(old.nightDim, 84);
  const restored = importSettings(
    exportSettings(
      normalizeSettings({
        nightBackground: 'solid',
        nightBrightness: 18,
        dayBrightness: 87,
        nightDim: 92,
      })
    ),
    normalizeSettings()
  );
  assert.equal(restored.nightBrightness, 18);
  assert.equal(restored.dayBrightness, 87);
  assert.equal(restored.nightDim, 92);
  assert.equal(restored.nightBackground, 'solid');
});

test('alarm settings survive restart; portable backup imports require enabling them again', () => {
  const source = normalizeSettings({
    alarms: [{ id: 'morning', time: '07:00', label: '起床', repeat: 'workday', enabled: true }],
  });
  assert.equal(normalizeSettings(JSON.parse(JSON.stringify(source))).alarms[0].enabled, true);
  const result = importSettings(exportSettings(source), normalizeSettings());
  assert.equal(result.alarms[0].enabled, false);
  assert.equal(result.alarms[0].repeat, 'workday');
  assert.equal(
    importSettings('{"app":"horizon-clock","schemaVersion":2,"settings":{}}', source).alarms.length,
    0
  );
});

test('malformed photo references and night-time arrays never enter settings', () => {
  const invalid = normalizeSettings({ scene: ['photo:' + 'a'.repeat(64)], nightStart: ['23:00'] });
  assert.equal(invalid.scene, 'lake');
  assert.equal(invalid.nightStart, '22:00');
  const valid = normalizeSettings({
    scene: 'photo:' + 'a'.repeat(64),
    nightBrightness: 0,
    dayBrightness: 999,
    nightDim: 200,
  });
  assert.equal(valid.scene, 'photo:' + 'a'.repeat(64));
  assert.equal(valid.nightBrightness, 10);
  assert.equal(valid.dayBrightness, 100);
  assert.equal(valid.nightDim, 95);
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
  assert.equal(migrated.weatherEnabled, true);
  assert.equal(migrated.autoNight, true);
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
  const current = normalizeSettings({ weatherEnabled: false });
  const backup = exportSettings(source),
    result = importSettings(backup, current);
  assert.equal(result.theme, 'moon');
  assert.equal(result.city, '上海');
  assert.equal(result.seconds, false);
  assert.equal(result.awake, false);
  assert.equal(result.weatherEnabled, false);
  assert.equal(result.onboarded, undefined);
  assert.equal(JSON.parse(backup).settings.awake, undefined);
  for (const value of [
    '{}',
    'null',
    '[]',
    '{"app":"horizon-clock","schemaVersion":3,"settings":{}}',
  ])
    assert.throws(() => importSettings(value, current));
  assert.throws(() => importSettings(' '.repeat(65537), current));
});

test('new installs use system location, weather and scheduled night by default; saved switches remain off', () => {
  const settings = normalizeSettings();
  assert.equal(settings.city, '自动定位');
  assert.equal(settings.weatherEnabled, true);
  assert.equal(settings.autoNight, true);
  assert.equal(settings.onboarded, undefined);
  const existing = normalizeSettings({
    weatherEnabled: false,
    autoNight: false,
    city: '上海',
    onboarded: true,
  });
  assert.equal(existing.weatherEnabled, false);
  assert.equal(existing.autoNight, false);
  assert.equal(existing.city, '上海');
});
