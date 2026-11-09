import { test, expect } from '@playwright/test';
import { normalizeSettings, SETTINGS_KEY } from '../../lib/settings.js';
import { NOW, weatherFixture } from '../fixtures.js';

const api = 'https://api.open-meteo.com/**';
const coords = { latitude: 31.23456, longitude: 121.47891 };
async function fresh(page) {
  await page.clock.install({ time: new Date(NOW) });
  await page.goto('/');
}
async function weatherSettings(page) {
  await page.locator('#settings-open').click();
  await page.getByRole('tab', { name: '天气', exact: true }).click();
}
async function unavailable(page, code = 1) {
  await page.addInitScript((code) => {
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: (_, error) => error({ code }) },
      configurable: true,
    });
  }, code);
}

test('fresh launch shows the clock directly with system weather and automatic night enabled', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(coords);
  let request;
  await page.route(api, (route) => {
    request = new URL(route.request().url());
    return route.fulfill({ json: weatherFixture() });
  });
  await fresh(page);
  await expect(page.locator('#temperature-value')).toHaveText('21');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#welcome-dialog')).toHaveCount(0);
  await expect(page.locator('#city-label')).toHaveText('当前位置');
  expect(request.searchParams.get('latitude')).toBe('31.23');
  expect(request.searchParams.get('longitude')).toBe('121.48');
  await weatherSettings(page);
  await expect(page.locator('#weather-enabled')).toBeChecked();
  await expect(page.locator('#city')).toHaveValue('自动定位');
  await page.getByRole('tab', { name: '显示', exact: true }).click();
  await expect(page.locator('#auto-night')).toBeChecked();
  await expect(page.locator('#night-start')).toHaveValue('22:00');
  await expect(page.locator('#night-end')).toHaveValue('07:00');
  await page.getByRole('button', { name: '完成设置' }).click();
  await page.clock.setSystemTime(new Date('2026-11-09T22:20:01+09:00'));
  await page.clock.runFor(1100);
  await expect(page.locator('#night-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('denied location never substitutes another city and manual city selection still works', async ({
  page,
}) => {
  await unavailable(page);
  let requests = 0;
  await page.route(api, (route) => {
    requests++;
    return route.fulfill({ json: weatherFixture() });
  });
  await fresh(page);
  await expect(page.locator('#weather-description')).toHaveText('定位未授权');
  await expect(page.locator('#hours')).toHaveText('12');
  expect(requests).toBe(0);
  await weatherSettings(page);
  await expect(page.locator('#weather-detail-status')).toContainText('手动选择城市');
  await page.locator('#city').selectOption('上海');
  await expect(page.locator('#temperature-value')).toHaveText('21');
  await expect(page.locator('#city-label')).toHaveText('上海');
  expect(requests).toBe(1);
});

test('an unanswered location permission has a bounded timeout and leaves the clock usable', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition() {} },
    })
  );
  await fresh(page);
  await expect(page.locator('#weather-description')).toHaveText('正在定位');
  await page.clock.runFor(10001);
  await expect(page.locator('#weather-description')).toHaveText('定位超时');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#hours')).toHaveText('12');
});

test('late system location cannot replace a newer manual city or trigger a weather request', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition(success) {
          window.finishLocation = success;
        },
      },
    })
  );
  const requests = [];
  await page.route(api, (route) => {
    requests.push(route.request().url());
    return route.fulfill({ json: weatherFixture() });
  });
  await fresh(page);
  await expect(page.locator('#weather-description')).toHaveText('正在定位');
  await weatherSettings(page);
  await page.locator('#city').selectOption('上海');
  await expect(page.locator('#temperature-value')).toHaveText('21');
  await page.evaluate(() =>
    window.finishLocation({ coords: { latitude: 35.68, longitude: 139.69 } })
  );
  await expect(page.locator('#city-label')).toHaveText('上海');
  expect(requests).toHaveLength(1);
});

test('a changed system position cannot reuse the previous location weather', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(coords);
  let fail = false;
  await page.route(api, (route) =>
    fail ? route.abort() : route.fulfill({ json: weatherFixture() })
  );
  await fresh(page);
  await expect(page.locator('#temperature-value')).toHaveText('21');
  await context.setGeolocation({ latitude: 35.68, longitude: 139.69 });
  fail = true;
  await weatherSettings(page);
  await page.locator('#weather-refresh').click();
  await expect(page.locator('#temperature-value')).toHaveText('--');
  await expect(page.locator('#weather-description')).toHaveText('暂不可用');
});

test('offline restart displays a labeled last-position cache without making requests after denied location', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(coords);
  let requests = 0;
  await page.route(api, (route) => {
    requests++;
    return route.fulfill({ json: weatherFixture() });
  });
  await fresh(page);
  await expect(page.locator('#temperature-value')).toHaveText('21');
  await unavailable(page);
  await page.reload();
  await expect(page.locator('#weather-status')).toContainText('缓存');
  await expect(page.locator('#city-label')).toHaveText('上次位置');
  await expect(page.locator('#temperature-value')).toHaveText('21');
  expect(requests).toBe(1);
  const location = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('horizon-location-v1'))
  );
  expect(location).toMatchObject({ latitude: 31.23, longitude: 121.48 });
});

test('saved disabled preferences remain off and legacy onboarding flags no longer open a guide', async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify({ ...value, onboarded: false }));
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition() {
            throw new Error('Must not locate');
          },
        },
      });
    },
    { key: SETTINGS_KEY, value: normalizeSettings({ weatherEnabled: false, autoNight: false }) }
  );
  await fresh(page);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#weather-description')).toHaveText('天气未启用');
  await weatherSettings(page);
  await expect(page.locator('#weather-enabled')).not.toBeChecked();
  await page.getByRole('tab', { name: '显示', exact: true }).click();
  await expect(page.locator('#auto-night')).not.toBeChecked();
});
