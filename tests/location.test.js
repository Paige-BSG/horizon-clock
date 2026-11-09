import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundedLocation, readLocation, systemLocation, LocationError } from '../lib/location.js';
import { weatherUrl, weatherPlaceKey, parseWeather, validCache } from '../lib/weather.js';
import { NOW, weatherFixture } from './fixtures.js';

test('system coordinates are validated, rounded and used to isolate weather caches', () => {
  const coords = { latitude: 31.23456, longitude: 121.47891 };
  assert.deepEqual(roundedLocation(coords), { latitude: 31.23, longitude: 121.48 });
  assert.equal(new URL(weatherUrl(coords)).searchParams.get('longitude'), '121.48');
  assert.equal(weatherPlaceKey(coords), 'location:31.23,121.48');
  const weather = parseWeather(weatherFixture(), coords, NOW);
  assert.equal(validCache(weather, { latitude: 31.23, longitude: 121.48 }, NOW), true);
  assert.equal(validCache(weather, { latitude: 35.68, longitude: 139.69 }, NOW), false);
  for (const value of [
    null,
    {},
    { latitude: NaN, longitude: 0 },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: '31', longitude: 121 },
  ]) {
    assert.throws(() => weatherUrl(value));
    assert.equal(validCache(weather, value, NOW), false);
  }
});

test('stored locations expire and malformed or future coordinates are rejected', () => {
  const read = (value) => readLocation({ getItem: () => JSON.stringify(value) }, NOW);
  assert.deepEqual(read({ latitude: 31.23, longitude: 121.48, fetchedAt: NOW }), {
    latitude: 31.23,
    longitude: 121.48,
  });
  for (const value of [
    null,
    { latitude: 31.23, longitude: 121.48, fetchedAt: NOW + 1 },
    { latitude: 31.23, longitude: 121.48, fetchedAt: NOW - 86400000 },
    { latitude: 91, longitude: 121, fetchedAt: NOW },
  ])
    assert.equal(read(value), null);
});

test('system lookup uses low accuracy, and cancellation ignores a late provider callback', async () => {
  const controller = new AbortController();
  let finish;
  const request = systemLocation(controller.signal, {
    getCurrentPosition(success, _, options) {
      assert.equal(options.enableHighAccuracy, false);
      assert.equal(options.timeout, 8000);
      assert.equal(options.maximumAge, 0);
      finish = success;
    },
  });
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  finish({ coords: { latitude: 31.23, longitude: 121.48 } });
  await assert.rejects(
    systemLocation(new AbortController().signal, {
      getCurrentPosition(_, fail) {
        fail({ code: 1 });
      },
    }),
    (error) => error instanceof LocationError && error.code === 1
  );
});
