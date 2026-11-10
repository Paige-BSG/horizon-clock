import { test, expect } from '@playwright/test';
import { normalizeSettings, SETTINGS_KEY } from '../../lib/settings.js';
import { NOW, weatherFixture } from '../fixtures.js';

async function start(page) {
  await page.clock.install({ time: new Date(NOW) });
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: SETTINGS_KEY,
      value: normalizeSettings({
        city: '上海',
        weatherEnabled: true,
        autoNight: false,
        rotate: false,
      }),
    }
  );
  await page.route('**/api.open-meteo.com/**', (route) =>
    route.fulfill({ json: weatherFixture() })
  );
  await page.goto('/');
  await expect(page.locator('#temperature-value')).toHaveText('21');
}
async function cleanClock(page) {
  await expect(page.locator('main .section-label')).toHaveCount(0);
  await expect(page.locator('#timezone')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('UTC');
  await expect(page.locator('#hours')).toHaveText('12');
  await expect(page.locator('#month-day')).toHaveText('11月09日');
  await expect(page.locator('.weather-description .location #city-label')).toHaveText('上海');
  await expect(page.locator('.weather-description .location #weather-status')).toContainText(
    '更新'
  );
}
async function fit(page, width, height, music = false) {
  await page.setViewportSize({ width, height });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  for (const selector of ['.clock-face', '.date-panel', '.weather-panel', '.location']) {
    const box = await page.locator(selector).boundingBox();
    expect(box.x, selector).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, selector).toBeLessThanOrEqual(width + 1);
    if (!music || width > 740) await expect(page.locator(selector)).toBeInViewport({ ratio: 0.99 });
  }
  const location = await page.locator('.location').boundingBox();
  const description = await page.locator('.weather-description').boundingBox();
  expect(location.y).toBeGreaterThanOrEqual(description.y);
  expect(location.y + location.height).toBeLessThanOrEqual(description.y + description.height + 1);
}

test('unlabeled clock keeps date and weather, with location beside weather details', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await start(page);
  await cleanClock(page);
  for (const [width, height] of [
    [1920, 1080],
    [1280, 800],
    [800, 1280],
    [390, 844],
  ]) {
    await fit(page, width, height);
    await page.screenshot({ path: `/tmp/horizon-clean-layout-${width}.png` });
  }
  expect(errors).toEqual([]);
});

test('music split retains the simpler date and weather layout across native viewport sizes', async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press('m');
  await cleanClock(page);
  for (const [width, height] of [
    [1408, 792],
    [1280, 720],
    [960, 540],
    [390, 844],
    [360, 540],
  ]) {
    await fit(page, width, height, true);
    await page.screenshot({
      path: `/tmp/horizon-clean-layout-music-${width}.png`,
      fullPage: width < 741,
    });
  }
});

test('relocated weather status retains offline cache and failure messages', async ({ page }) => {
  await start(page);
  await page.unroute('**/api.open-meteo.com/**');
  await page.route('**/api.open-meteo.com/**', (route) => route.abort());
  await page.reload();
  await expect(page.locator('.location #weather-status')).toContainText('缓存');
  await expect(page.locator('#temperature-value')).toHaveText('21');
  await page.keyboard.press('s');
  await page.getByRole('tab', { name: '天气', exact: true }).click();
  await page.locator('#city').selectOption('东京');
  await page.getByRole('button', { name: '完成设置' }).click();
  await expect(page.locator('.location #city-label')).toHaveText('东京');
  await expect(page.locator('#weather-description')).toHaveText('暂不可用');
  await expect(page.locator('#temperature-value')).toHaveText('--');
});
