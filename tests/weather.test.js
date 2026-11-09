import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weatherUrl,
  parseWeather,
  validCache,
  weatherDescription,
  windDirection,
  WEATHER_MAX_AGE,
} from '../lib/weather.js';
import { NOW, weatherFixture } from './fixtures.js';
test('request contains only selected city coordinates and explicitly selected fields', () => {
  const url = new URL(weatherUrl('上海'));
  assert.equal(url.hostname, 'api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), '31.23');
  assert.equal(url.searchParams.get('forecast_days'), '1');
  assert.throws(() => weatherUrl('constructor'));
});
test('weather response converts numbers and labels without inventing missing data', () => {
  const parsed = parseWeather(weatherFixture(), '东京', NOW);
  assert.equal(parsed.temperature, 21);
  assert.equal(parsed.direction, '东北风');
  assert.equal(weatherDescription(95), '雷阵雨');
  assert.equal(weatherDescription(0, false), '晴夜');
  assert.equal(windDirection(359), '北风');
  assert.equal(windDirection(-45), '西北风');
});
test('bad units, missing fields, impossible values and old observations are rejected', () => {
  for (const mutate of [
    (p) => delete p.current,
    (p) => (p.current.temperature_2m = null),
    (p) => (p.current.relative_humidity_2m = 101),
    (p) => (p.current_units.temperature_2m = '°F'),
    (p) => (p.daily.temperature_2m_min[0] = 40),
    (p) => (p.current.time -= 90000),
    (p) => (p.current.time += 90000),
    (p) => (p.current.weather_code = -1),
  ]) {
    const payload = weatherFixture();
    mutate(payload);
    assert.throws(() => parseWeather(payload, '东京', NOW));
  }
});
test('cache is tied to a city, expires after a day and rejects corrupt timestamps', () => {
  const value = parseWeather(weatherFixture(), '东京', NOW);
  assert.equal(validCache(value, '东京', NOW + 1), true);
  assert.equal(validCache(value, '上海', NOW), false);
  assert.equal(validCache(value, '东京', NOW + WEATHER_MAX_AGE), false);
  assert.equal(validCache({ ...value, fetchedAt: NOW + 999999 }, '东京', NOW), false);
  assert.equal(validCache({ ...value, temperature: '21' }, '东京', NOW), false);
});
