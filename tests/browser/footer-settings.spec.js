import { test, expect } from '@playwright/test';
import { normalizeSettings, SETTINGS_KEY } from '../../lib/settings.js';

async function start(page) {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SETTINGS_KEY,
    value: normalizeSettings({ weatherEnabled: false, autoNight: false, rotate: false }),
  });
  await page.goto('/');
}

test('bottom details are available only in settings and keep their controls', async ({ page }) => {
  await start(page);
  await expect(page.locator('main > footer')).toHaveCount(0);
  await expect(page.locator('.music-footer')).toHaveCount(0);
  for (const id of ['wake-status', 'image-source', 'netease-account', 'music-motion']) {
    await expect(page.locator(`#${id}`)).toBeHidden();
    await expect(page.locator(`#settings-dialog #${id}`)).toHaveCount(1);
  }
  await expect(page.locator('#night-toggle')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/horizon-clean-clock.png' });
  await page.locator('#settings-open').click();
  await expect(page.locator('#wake-status')).toBeVisible();
  await page.locator('#night-mode').check();
  await expect(page.locator('body')).toHaveClass(/night/);
  await page.locator('#night-mode').uncheck();
  await expect(page.locator('body')).not.toHaveClass(/night/);
  await expect(page.locator('#music-motion')).toBeVisible();
  await expect(page.locator('#music-motion')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#music-motion').click();
  await expect(page.locator('#music-motion')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('tab', { name: '背景', exact: true }).click();
  await expect(page.locator('#scene-caption')).toContainText('湖畔晨雾');
  await expect(page.locator('#scene-credit')).toContainText('Luca Bravo');
  await page.locator('#image-source').click();
  await expect(page.locator('#photo-source-dialog')).toBeVisible();
  await expect(page.locator('#photo-source-link')).toHaveAttribute('href', /unsplash.com/);
  await page.locator('#photo-source-close').click();
  await page.getByRole('tab', { name: '应用', exact: true }).click();
  await expect(page.locator('#netease-account')).toBeVisible();
  await expect(page.locator('#music-source')).toHaveCount(0);
  await page.getByRole('button', { name: '完成设置', exact: true }).click();
  await page.keyboard.press('m');
  await expect(page.locator('#music-panel')).toBeVisible();
  await expect(page.locator('#music-motion')).toBeHidden();
  await expect(page.locator('#netease-account')).toBeHidden();
  await expect(page.locator('#music-panel')).toHaveAttribute('data-wave-peak', '0');
  await page.screenshot({ path: '/tmp/horizon-clean-player.png' });
});

test('background details and relocated controls fit a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page.locator('#settings-open').click();
  await page.locator('#music-motion').scrollIntoViewIfNeeded();
  await expect(page.locator('#music-motion')).toBeVisible();
  await page.getByRole('tab', { name: '背景', exact: true }).click();
  await page.locator('#image-source').scrollIntoViewIfNeeded();
  const bounds = await page.locator('#image-source').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/horizon-settings-background-mobile.png' });
});
