import { test, expect } from '@playwright/test';
import { normalizeSettings, SETTINGS_KEY } from '../../lib/settings.js';

import { start, choose, account, sourceAction } from './music-fixture.js';

test('restored account shows own playlists without autoplay; clock stays visible', async ({
  page,
}) => {
  await start(page);
  await choose(page);
  expect(
    await page.evaluate(() => window.nativeCalls.some((c) => c.args?.action?.type === 'play'))
  ).toBe(false);
  await expect(page.locator('#music-toggle')).toBeDisabled();
  await expect(page.locator('.clock-information')).toBeVisible();
  await expect(page.locator('#music-radio, #music-channels, #radio-stream')).toHaveCount(0);
  await expect(page.locator('#netease-account')).toBeHidden();
  await expect(page.locator('#music-panel')).toHaveAttribute('data-wave-peak', '0');
  await page.screenshot({ path: '/tmp/horizon-netease-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#netease-playlists')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: '/tmp/horizon-netease-mobile.png', fullPage: true });
});

test('native controls play, pause, resume, change volume and select adjacent songs', async ({
  page,
}) => {
  await start(page);
  await choose(page);
  await page.locator('#netease-tracks button').first().click();
  await expect(page.locator('#music-title')).toHaveText('测试歌曲甲');
  await page.getByRole('button', { name: '暂停歌曲', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('已暂停');
  await expect(page.locator('#music-panel')).toHaveAttribute('data-wave-peak', '0');
  await page.getByRole('button', { name: '播放歌曲', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('播放中');
  await page.locator('#music-volume-toggle').click();
  await page.locator('#music-volume').fill('64');
  await page.locator('#music-volume').dispatchEvent('change');
  await expect(page.locator('#music-volume-value')).toHaveText('64%');
  await page.locator('#netease-next').click();
  await expect(page.locator('#music-title')).toHaveText('测试歌曲乙');
  await page.locator('#netease-previous').click();
  await expect(page.locator('#music-title')).toHaveText('测试歌曲甲');
  await page.evaluate(() => {
    window.endTrack = true;
  });
  await expect(page.locator('#music-title')).toHaveText('测试歌曲乙', { timeout: 4000 });
});

test('collapsing and browsing preserve playback; reopening restores the player view', async ({
  page,
}) => {
  await start(page);
  await choose(page);
  await page.locator('#netease-tracks button').first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#music-now-playing')).toBeVisible();
  await expect(page.locator('#music-status')).toHaveText('播放中');
  await page.keyboard.press('Escape');
  await expect(page.locator('#music-panel')).toBeHidden();
  await expect(page.locator('#music-open')).toBeFocused();
  await page.keyboard.press('m');
  await expect(page.locator('#music-status')).toHaveText('播放中');
  expect(
    await page.evaluate(() => window.nativeCalls.some((c) => c.args?.action?.type === 'stop'))
  ).toBe(false);
});

test('QR is in-app, expires without regeneration, and can be canceled', async ({ page }) => {
  await start(page, false);
  await account(page);
  await page.locator('#netease-connect').click();
  await expect(page.locator('#netease-qr')).toBeVisible();
  await expect(page.locator('#netease-qr')).toBeHidden({ timeout: 5000 });
  await expect(page.locator('#netease-account-help')).toHaveText('二维码已过期');
  expect(
    await page.evaluate(
      () => window.nativeCalls.filter((c) => c.args?.action?.type === 'login').length
    )
  ).toBe(1);
  await page.locator('#netease-connect').click();
  await page.locator('#netease-cancel').click();
  await expect(page.locator('#netease-qr')).toBeHidden();
  await expect(page.locator('#netease-account-help')).toBeHidden();
});

test('permission failure stays explicit; logout clears the local view', async ({ page }) => {
  await start(page);
  await choose(page);
  await page.evaluate(() => {
    window.failAction = 'play';
  });
  await page.locator('#netease-tracks button').first().click();
  await expect(page.locator('#music-help')).toHaveText('当前账号无法播放此歌曲');
  await expect(page.locator('#music-panel')).toHaveAttribute('data-wave-peak', '0');
  await account(page);
  await page.locator('#netease-logout').click();
  await expect(page.locator('#netease-account-status')).toHaveText('未登录');
  await expect(page.locator('#netease-browser')).toBeHidden();
});

test('web preview clearly limits native login', async ({ page }) => {
  await page.addInitScript(
    ({ key, settings }) => localStorage.setItem(key, JSON.stringify(settings)),
    { key: SETTINGS_KEY, settings: normalizeSettings({ weatherEnabled: false, autoNight: false }) }
  );
  await page.goto('/');
  await page.keyboard.press('m');
  await account(page);
  await expect(page.locator('#netease-account-status')).toHaveText('桌面版可用');
  await expect(page.locator('#netease-connect')).toBeHidden();
  await expect(page.locator('#music-toggle')).toBeDisabled();
});

test('readable text keeps a long library scrollable and native playback controls visible', async ({
  page,
}) => {
  await start(page, true, true);
  await sourceAction(page, 'music-library-toggle');
  await page.locator('#netease-playlists').selectOption('21');
  await expect(page.locator('#netease-tracks button')).toHaveCount(100);
  await page.locator('#netease-tracks button').first().click();
  for (const [width, height] of [
    [1408, 792],
    [1280, 720],
    [960, 540],
  ]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBe(height);
    await expect(page.locator('#music-toggle')).toBeInViewport({ ratio: 0.99 });
    const list = await page.locator('#netease-track-list').boundingBox();
    expect(list.height).toBeGreaterThanOrEqual(width >= 1280 ? 175 : 55);
    await page.locator('#netease-tracks button').last().scrollIntoViewIfNeeded();
    await expect(page.locator('#netease-tracks button').last()).toBeVisible();
    expect(
      await page
        .locator('#netease-tracks button small')
        .first()
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
    ).toBeGreaterThanOrEqual(13);
    await page.screenshot({ path: `/tmp/horizon-netease-library-${width}.png` });
    await sourceAction(page, 'music-library-toggle');
    await expect(page.locator('#music-title')).toBeInViewport({ ratio: 0.99 });
    await expect(page.locator('#music-toggle')).toBeInViewport({ ratio: 0.99 });
    const title = await page.locator('#music-title').boundingBox();
    const stage = await page.locator('#music-now-playing').boundingBox();
    expect(title.x + title.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
    expect(title.height).toBeLessThanOrEqual(105);
    await page.screenshot({ path: `/tmp/horizon-netease-playing-${width}.png` });
    await sourceAction(page, 'music-library-toggle');
  }
});

test('closing settings during a slow QR request cancels the resulting login without polling', async ({
  page,
}) => {
  await start(page, false);
  await account(page);
  await page.evaluate(() => (window.delayLogin = true));
  await page.locator('#netease-connect').click();
  await page.waitForFunction(() => !!window.finishLogin);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await page.evaluate(() => window.finishLogin());
  await expect
    .poll(() =>
      page.evaluate(() => window.nativeCalls.some((c) => c.args?.action?.type === 'cancel_login'))
    )
    .toBe(true);
  await expect.poll(() => page.locator('#netease-qr').getAttribute('src')).toBe(null);
  await account(page);
  await expect(page.locator('#netease-connect')).toBeEnabled();
  expect(
    await page.evaluate(() => window.nativeCalls.some((c) => c.args?.action?.type === 'poll_login'))
  ).toBe(false);
});
