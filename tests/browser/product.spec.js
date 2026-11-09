import { test, expect } from '@playwright/test';
import { normalizeSettings, SETTINGS_KEY, exportSettings } from '../../lib/settings.js';
import { NOW, weatherFixture } from '../fixtures.js';

async function start(page, preferences = {}) {
  await page.clock.install({ time: new Date(NOW) });
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SETTINGS_KEY,
    value: normalizeSettings({
      weatherEnabled: false,
      autoNight: false,
      city: '东京',
      ...preferences,
    }),
  });
  await page.goto('/');
}
async function settings(page, tab) {
  await page.keyboard.press('s');
  await page.getByRole('tab', { name: tab, exact: true }).click();
}
const api = '**/api.open-meteo.com/**';

test('clock crosses midnight and year boundaries using device local time', async ({ page }) => {
  await start(page);
  await page.clock.setSystemTime(new Date('2026-12-31T23:59:58+09:00'));
  await page.clock.runFor(3100);
  await expect(page.locator('#hours')).toHaveText('00');
  await expect(page.locator('#month-day')).toHaveText('01月01日');
  await expect(page.locator('#year')).toHaveText('2027');
  await expect(page.locator('#weekday')).toHaveText('星期五');
  await expect(page.locator('#week-number')).toHaveText('第 53 周');
});

test('landscapes rotate, can be fixed, and can be replaced by solid color', async ({ page }) => {
  await start(page, { interval: 30 });
  await expect(page.locator('.landscape-backdrop')).toHaveClass(/ready/);
  await page.clock.runFor(30100);
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /mountain/);
  await settings(page, '背景');
  await page.locator('#rotate-background').uncheck();
  await page.getByRole('button', { name: '完成设置' }).click();
  await page.clock.runFor(60100);
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /mountain/);
  await settings(page, '背景');
  await page.getByRole('button', { name: '纯色', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-background', 'solid');
  await expect(page.locator('#background-next')).toBeHidden();
});

test('weather failure never presents a permanent loading screen', async ({ page }) => {
  await page.route(api, (route) => route.abort());
  await start(page, { weatherEnabled: true });
  await expect(page.locator('#weather-description')).toHaveText('暂不可用');
  await expect(page.locator('#temperature-value')).toHaveText('--');
  await expect(page.locator('#hours')).toHaveText('12');
});

test('weather has a bounded timeout when the provider stops responding', async ({ page }) => {
  await page.route(api, () => {});
  await start(page, { weatherEnabled: true });
  await expect(page.locator('#weather-description')).toHaveText('正在更新');
  await page.clock.runFor(11000);
  await expect(page.locator('#weather-description')).toHaveText('暂不可用');
});

test('offline cache survives restart and cannot leak into a different city', async ({ page }) => {
  await page.route(api, (route) => route.fulfill({ json: weatherFixture() }));
  await start(page, { weatherEnabled: true });
  await expect(page.locator('#temperature-value')).toHaveText('21');
  await page.unroute(api);
  await page.route(api, (route) => route.abort());
  await page.reload();
  await expect(page.locator('#weather-status')).toHaveText(/缓存/);
  await settings(page, '天气');
  await page.locator('#city').selectOption('上海');
  await expect(page.locator('#temperature-value')).toHaveText('--');
  await expect(page.locator('#weather-description')).toHaveText('暂不可用');
});

test('automatic night fade and manual override remain coherent', async ({ page }) => {
  await start(page, { autoNight: true });
  await page.clock.setSystemTime(new Date('2026-11-09T22:10:00+09:00'));
  await page.clock.runFor(1000);
  const brightness = await page
    .locator('body')
    .evaluate((e) => Number(e.style.getPropertyValue('--display-brightness')));
  expect(brightness).toBeGreaterThan(0.7);
  expect(brightness).toBeLessThan(0.72);
  await page.keyboard.press('n');
  await expect(page.locator('#night-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('n');
  await expect(page.locator('#night-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.clock.setSystemTime(new Date('2026-11-10T08:00:00+09:00'));
  await page.clock.runFor(1000);
  await expect(page.locator('#night-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('backup restores visual preferences without enabling network or power controls', async ({
  page,
}) => {
  await start(page);
  await settings(page, '应用');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出设置' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('horizon-settings.json');
  await page.locator('#import-file').setInputFiles({
    name: 'settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      exportSettings(
        normalizeSettings({ theme: 'amber', awake: true, weatherEnabled: true, city: '上海' })
      )
    ),
  });
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'amber');
  await expect(page.locator('#weather-enabled')).not.toBeChecked();
  await expect(page.locator('#keep-awake')).not.toBeChecked();
  await expect(page.locator('#city-label')).toHaveText('上海');
  await page.locator('#import-file').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"settings":{}}'),
  });
  await expect(page.locator('#toast')).toHaveText(/未能导入/);
});

test('failed scenic assets fall back to solid background', async ({ page }) => {
  await page.route('**/landscapes/*.jpg', (route) => route.abort());
  await start(page);
  await expect(page.locator('body')).toHaveAttribute('data-background', 'solid');
  await expect(page.locator('#hours')).toHaveText('12');
});

test('eight target sizes fit without page overflow', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page);
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [1024, 768],
    [800, 1280],
    [390, 844],
    [1280, 720],
    [1920, 1080],
    [2736, 1824],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.scrollHeight,
      ])
    ).toEqual([width, height]);
  }
  expect(errors).toEqual([]);
});

test('update checks report missing releases without downloading executable content', async ({
  page,
}) => {
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({ status: 404, json: { message: 'Not Found' } })
  );
  await start(page);
  await settings(page, '应用');
  await page.getByRole('button', { name: '检查更新' }).click();
  await expect(page.locator('#update-status')).toHaveText(/尚无正式发行版/);
});

test('preview server does not expose repository or machine files', async ({ request }) => {
  for (const path of [
    '/.git/config',
    '/README.md',
    '/src-tauri/Cargo.toml',
    '/assets/../../package.json',
  ])
    expect((await request.get(path)).status()).toBe(404);
});

test('desktop controls call only the intended native operations', async ({ page }) => {
  await page.addInitScript(() => {
    window.testNativeCalls = [];
    const state = { fullscreen: false, autostart: false, awake: false };
    window.__TAURI__ = {
      core: {
        invoke: async (command, args = {}) => {
          window.testNativeCalls.push({ command, args });
          if (command === 'get_fullscreen') return state.fullscreen;
          if (command === 'get_autostart') return state.autostart;
          if (command === 'set_fullscreen') return (state.fullscreen = args.enabled);
          if (command === 'set_autostart') return (state.autostart = args.enabled);
          if (command === 'set_keep_awake') return (state.awake = args.enabled);
          throw Error('Unexpected native command');
        },
      },
    };
  });
  await start(page);
  await expect(page.getByRole('button', { name: '退出全屏', exact: true })).toBeVisible();
  await settings(page, '应用');
  await expect(page.locator('#autostart')).toBeEnabled();
  await page.locator('#autostart').check();
  await page.getByRole('tab', { name: '显示', exact: true }).click();
  await page.locator('#keep-awake').check();
  await expect(page.locator('#wake-status')).toHaveText('屏幕常亮已开启');
  await page.locator('#keep-awake').uncheck();
  await expect(page.locator('#wake-status')).toHaveText('常亮待开启');
  await page.getByRole('button', { name: '完成设置' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '进入全屏', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.testNativeCalls)).toEqual(
    expect.arrayContaining([
      { command: 'set_autostart', args: { enabled: true } },
      { command: 'set_keep_awake', args: { enabled: true } },
      { command: 'set_keep_awake', args: { enabled: false } },
    ])
  );
});

test('weather symbols reflect rain rather than showing sunshine at night', async ({ page }) => {
  const weather = weatherFixture();
  weather.current.weather_code = 95;
  weather.current.is_day = 0;
  await page.route(api, (route) => route.fulfill({ json: weather }));
  await start(page, { weatherEnabled: true });
  await expect(page.locator('#weather-description')).toHaveText('雷阵雨');
  await expect(page.locator('#weather-sun')).toBeHidden();
  await expect(page.locator('#weather-rain')).toBeVisible();
  await expect(page.locator('#weather-snow')).toBeHidden();
});

test('desktop layout fits logical viewports after fullscreen-size changes', async ({ page }) => {
  await page.addInitScript(() => {
    window.__TAURI__ = { core: { invoke: async () => false } };
  });
  await page.setViewportSize({ width: 1408, height: 792 });
  await start(page);
  await page.evaluate(() => document.fonts.ready);
  for (const viewport of [
    { width: 1408, height: 792 },
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        }))
      )
      .toEqual(viewport);
  }
});
