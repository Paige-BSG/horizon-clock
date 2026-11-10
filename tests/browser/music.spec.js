import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { start, choose, account, sourceAction } from './music-fixture.js';

test('only native NetEase remains, with no radio traffic, elements or remembered autoplay', async ({
  page,
}) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.addInitScript(() =>
    localStorage.setItem(
      'horizon-radio-v1',
      JSON.stringify({ station: 'main', volume: 0.8, requested: true })
    )
  );
  await start(page);
  await expect(
    page.locator('#music-radio, #music-netease, #music-channels, #radio-stream, audio')
  ).toHaveCount(0);
  await expect(page.locator('#music-panel')).toHaveAttribute('data-view', 'player');
  await expect(page.locator('#netease-library')).toBeHidden();
  await expect(page.locator('#netease-account')).toBeHidden();
  await expect(page.locator('#music-toggle')).toBeDisabled();
  expect(requests.some((url) => /radioparadise/.test(url))).toBe(false);
  expect(
    await page.evaluate(() =>
      window.nativeCalls.some(
        (call) => /radio/.test(call.command) || call.args?.action?.type === 'play'
      )
    )
  ).toBe(false);
  const policy = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8')).app.security.csp;
  expect(policy).toContain("media-src 'none'");
  expect(policy).not.toContain('radioparadise');
});

test('account management lives in settings and login entry opens it', async ({ page }) => {
  await start(page, false);
  await expect(page.locator('#music-account-open')).toBeHidden();
  await sourceAction(page, 'music-account-open');
  await expect(page.locator('#system-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#netease-connect')).toBeFocused();
  await page.locator('#netease-connect').click();
  await expect(page.locator('#netease-qr')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#netease-qr')).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.nativeCalls.some((call) => call.args?.action?.type === 'cancel_login')
      )
    )
    .toBe(true);
});

test('music retains 4:6 clock layout and readable metadata across desktop and small screens', async ({
  page,
}) => {
  await start(page);
  for (const [width, height] of [
    [1920, 1080],
    [1408, 792],
    [1280, 720],
    [960, 540],
    [800, 1280],
    [390, 844],
    [360, 540],
  ]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    for (const selector of [
      '.clock-face',
      '.date-panel',
      '.weather-panel',
      '#music-panel',
      '#netease-transport',
    ]) {
      const rect = await page.locator(selector).boundingBox();
      expect(rect.x, selector).toBeGreaterThanOrEqual(-1);
      expect(rect.x + rect.width, selector).toBeLessThanOrEqual(width + 1);
      if (width > 740) await expect(page.locator(selector)).toBeInViewport({ ratio: 0.99 });
    }
    if (width > 740) {
      const panel = await page.locator('#music-panel').boundingBox();
      const clock = await page.locator('.clock-information').boundingBox();
      expect(panel.width / clock.width).toBeCloseTo(2 / 3, 1);
    }
    await page.screenshot({
      path: `/tmp/horizon-music-player-${width}.png`,
      fullPage: width <= 740,
    });
  }
});

test('logical viewport scaling retains all controls without scrolling the desktop', async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-vw', '14.08px');
    document.documentElement.style.setProperty('--app-vh', '7.92px');
  });
  // Native viewport units can differ from browser units; normal resize restores the measured values.
  await page.setViewportSize({ width: 1408, height: 792 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBe(792);
  await expect(page.locator('#music-toggle')).toBeInViewport({ ratio: 0.99 });
});

test('waveform follows native samples, pauses flat and releases capture in library and collapsed views', async ({
  page,
}) => {
  await start(page);
  await choose(page);
  await page.locator('#netease-tracks button').first().click();
  await sourceAction(page, 'music-library-toggle');
  await page.evaluate(() => {
    window.nativeLevels = [
      0.04,
      0.7,
      0.2,
      0.3,
      0.1,
      ...Array(24).fill(0.3),
      ...Array.from({ length: 64 }, (_, i) => Math.sin(i * 0.5) * 0.7),
    ];
  });
  await account(page);
  await page.getByRole('tab', { name: '显示', exact: true }).click();
  await page.getByRole('button', { name: '开启声纹动效', exact: true }).click();
  await page.getByRole('button', { name: '完成设置', exact: true }).click();
  await expect
    .poll(() => page.locator('#music-panel').getAttribute('data-wave-peak'))
    .not.toBe('0');
  await expect(page.locator('#music-panel')).toHaveAttribute('data-audio-rms', '0.04');
  await page.locator('#music-volume-toggle').click();
  await page.locator('#music-volume').fill('0');
  await page.locator('#music-volume').dispatchEvent('change');
  await expect(page.locator('#music-panel')).toHaveAttribute('data-wave-peak', '0');
  await page.locator('#music-volume').fill('50');
  await page.locator('#music-volume').dispatchEvent('change');
  await expect
    .poll(() => page.locator('#music-panel').getAttribute('data-wave-peak'))
    .not.toBe('0');
  await page.locator('#music-toggle').click();
  await expect(page.locator('#music-panel')).toHaveAttribute('data-wave-peak', '0');
  const frames = await page.locator('#music-panel').getAttribute('data-frames');
  await page.waitForTimeout(200);
  expect(await page.locator('#music-panel').getAttribute('data-frames')).toBe(frames);
  await page.locator('#music-toggle').click();
  await sourceAction(page, 'music-library-toggle');
  await expect
    .poll(() =>
      page.evaluate(
        () => window.nativeCalls.filter((c) => c.command === 'set_music_meter').at(-1)?.args.enabled
      )
    )
    .toBe(false);
  await page.locator('#music-open').click();
  await expect(page.locator('#music-panel')).toBeHidden();
  expect(
    await page.evaluate(() => window.nativeCalls.some((c) => c.args?.action?.type === 'stop'))
  ).toBe(false);
});

test('an unavailable canvas leaves native playback controls functional', async ({ page }) => {
  await page.addInitScript(() => (HTMLCanvasElement.prototype.getContext = () => null));
  await start(page);
  await choose(page);
  await page.locator('#netease-tracks button').first().click();
  await page.locator('#music-toggle').click();
  await expect(page.locator('#music-status')).toHaveText('已暂停');
  await expect(page.locator('#music-panel')).toHaveAttribute('data-renderer', 'none');
});

test('playback stays grouped, list pagination stays with songs, and the toolbar owns open and close', async ({
  page,
}) => {
  await start(page);
  await choose(page);
  await page.locator('#netease-tracks button').first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#music-close, .music-heading, .music-provider')).toHaveCount(0);
  await expect(page.locator('#music-panel').getByText('网易云音乐', { exact: true })).toHaveCount(
    0
  );
  for (const button of await page.locator('#music-panel button').all()) {
    expect(
      await button.evaluate(
        (e) => !!e.closest('.music-console') || !!e.closest('#netease-track-list')
      )
    ).toBe(true);
  }
  const player = await page.locator('.music-console').boundingBox();
  await sourceAction(page, 'music-library-toggle');
  const library = await page.locator('.music-console').boundingBox();
  expect(Math.abs(player.y - library.y)).toBeLessThanOrEqual(1);
  await page.locator('#music-open').click();
  await expect(page.locator('#music-panel')).toBeHidden();
  await expect(page.locator('#music-open')).toHaveAttribute('aria-label', '展开音乐');
  await expect(page.locator('#music-open')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#music-open').click();
  await expect(page.locator('#music-open')).toHaveAttribute('aria-label', '收起音乐');
  await expect(page.locator('#music-open')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#music-status')).toHaveText('播放中');
  expect(
    await page.evaluate(
      () => window.nativeCalls.filter((c) => c.args?.action?.type === 'play').length
    )
  ).toBe(1);
});

test('the player groups fit compact libraries and load-more stays inside the list', async ({
  page,
}) => {
  await start(page, true, true);
  await page.evaluate(
    () =>
      (window.extraTracks = [{ id: '999', name: '末页测试', artist: '测试歌手', duration: 180 }])
  );
  await sourceAction(page, 'music-library-toggle');
  await page.locator('#netease-playlists').selectOption('21');
  await page.locator('#netease-tracks button').first().click();
  for (const [width, height] of [
    [1408, 792],
    [1280, 720],
    [960, 540],
    [390, 844],
    [360, 540],
  ]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (width > 740)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
        .toBe(height);
    else await page.locator('.music-console').scrollIntoViewIfNeeded();
    const console = await page.locator('.music-console').boundingBox();
    const content = await page.locator('.music-content').boundingBox();
    expect(console.y).toBeGreaterThanOrEqual(content.y + content.height - 1);
    for (const id of [
      'music-source-toggle',
      'music-shuffle',
      'music-repeat',
      'music-queue-toggle',
      'music-volume-toggle',
      'music-toggle',
    ]) {
      const action = page.locator(`#${id}`);
      await expect(action).toBeVisible();
      const box = await action.boundingBox();
      expect(box.x, id).toBeGreaterThanOrEqual(console.x - 1);
      expect(box.x + box.width, id).toBeLessThanOrEqual(console.x + console.width + 1);
      expect(box.y + box.height, id).toBeLessThanOrEqual(console.y + console.height + 1);
      expect(box.height, id).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('#netease-more')).toBeAttached();
    expect(
      await page.locator('#netease-more').evaluate((e) => !!e.closest('#netease-track-list'))
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/horizon-player-reference-${width}.png`,
      fullPage: width <= 740,
    });
  }
});

test('current list and volume open independently without interrupting playback', async ({
  page,
}) => {
  await start(page);
  await choose(page);
  await page.locator('#netease-tracks button').first().click();
  await page.keyboard.press('Escape');
  await page.locator('#music-queue-toggle').click();
  await expect(page.locator('#music-panel')).toHaveAttribute('data-view', 'queue');
  await expect(page.locator('#netease-playlists')).toBeHidden();
  await expect(page.locator('#music-current-list-heading')).toBeVisible();
  await expect(page.locator('#netease-tracks button')).toHaveCount(2);
  await sourceAction(page, 'music-library-toggle');
  await expect(page.locator('#netease-playlists')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#music-volume-toggle').click();
  await expect(page.locator('#music-volume')).toBeFocused();
  await page.locator('#music-volume').fill('30');
  await page.locator('#music-volume').dispatchEvent('change');
  await expect(page.locator('#music-volume-toggle')).toHaveAttribute('aria-label', '音量：30%');
  await page.keyboard.press('Escape');
  await expect(page.locator('#music-volume-panel')).toBeHidden();
  await expect(page.locator('#music-volume-toggle')).toBeFocused();
  await expect(page.locator('#music-panel')).toBeVisible();
  await expect(page.locator('#music-status')).toHaveText('播放中');
  expect(
    await page.evaluate(
      () => window.nativeCalls.filter((c) => c.args?.action?.type === 'play').length
    )
  ).toBe(1);
  const ids = await page
    .locator('#netease-transport button')
    .evaluateAll((buttons) => buttons.map((b) => b.id));
  expect(ids).toEqual([
    'music-shuffle',
    'netease-previous',
    'music-toggle',
    'netease-next',
    'music-repeat',
  ]);
});

test('source menu is compact, keyboard accessible, closes without collapsing music, and never autoplays', async ({
  page,
}) => {
  await start(page);
  const toggle = page.locator('#music-source-toggle');
  const menu = page.getByRole('menu', { name: '选歌方式' });
  await expect(menu).toBeHidden();
  await expect(page.locator('#music-library-toggle')).toBeHidden();
  await expect(page.locator('#music-fm')).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#music-library-toggle')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#music-fm')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.locator('#music-library-toggle')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#music-fm')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(page.locator('#music-panel')).toBeVisible();
  await toggle.click();
  await toggle.click();
  await expect(menu).toBeHidden();
  await toggle.click();
  await page.keyboard.press('Shift+Tab');
  await expect(menu).toBeHidden();
  await expect(page.locator('#music-panel')).toBeVisible();
  await toggle.click();
  await page.locator('#music-title').click();
  await expect(menu).toBeHidden();
  expect(
    await page.evaluate(() =>
      window.nativeCalls.some((c) => ['play', 'fm', 'login'].includes(c.args?.action?.type))
    )
  ).toBe(false);
});

test('source menu fits narrow screens and source selection preserves playing audio', async ({
  page,
}) => {
  await start(page);
  await choose(page);
  await page.locator('#netease-tracks button').first().click();
  await page.keyboard.press('Escape');
  for (const [width, height] of [
    [1280, 720],
    [960, 540],
    [390, 844],
    [360, 540],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator('#music-source-toggle').scrollIntoViewIfNeeded();
    await page.locator('#music-source-toggle').click();
    const menu = await page.locator('#music-source-menu').boundingBox();
    const transport = await page.locator('#netease-transport').boundingBox();
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(width);
    expect(menu.y + menu.height).toBeLessThanOrEqual(transport.y);
    for (const id of ['music-library-toggle', 'music-fm'])
      expect((await page.locator(`#${id}`).boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: `/tmp/horizon-source-menu-${width}.png`,
      fullPage: width <= 740,
    });
    await page.keyboard.press('Escape');
  }
  await page.locator('#music-volume-toggle').click();
  await page.locator('#music-source-toggle').click();
  await expect(page.locator('#music-volume-panel')).toBeHidden();
  await page.locator('#music-library-toggle').click();
  await expect(page.locator('#music-source-menu')).toBeHidden();
  await expect(page.locator('#netease-playlists')).toBeFocused();
  await expect(page.locator('#music-status')).toHaveText('播放中');
  await page.keyboard.press('Escape');
  await page.locator('#music-source-toggle').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(page.locator('#music-source-menu')).toBeHidden();
  await expect(page.locator('#music-queue-toggle')).toBeFocused();
  expect(
    await page.evaluate(
      () => window.nativeCalls.filter((c) => c.args?.action?.type === 'play').length
    )
  ).toBe(1);
});
