import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { normalizeSettings, SETTINGS_KEY } from '../../lib/settings.js';
import { RADIO_KEY, STATIONS } from '../../lib/radio.js';

// Silent PCM exercises the real browser decoder without playing music in tests.
const samples = 8000 * 30;
const audio = Buffer.alloc(44 + samples * 2);
audio.write('RIFF');
audio.writeUInt32LE(audio.length - 8, 4);
audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24);
audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write('data', 36);
audio.writeUInt32LE(samples * 2, 40);
const stream = 'https://stream.radioparadise.com/**';
async function start(page, preferences = {}, native = false) {
  await page.addInitScript(
    ({ key, settings, radioKey, preferences, native }) => {
      localStorage.setItem(key, JSON.stringify(settings));
      if (!localStorage.getItem(radioKey))
        localStorage.setItem(radioKey, JSON.stringify(preferences));
      window.nativeCalls = [];
      if (native)
        window.__TAURI__ = {
          core: {
            invoke: async (command, args) => {
              window.nativeCalls.push({ command, args });
              if (
                command === 'check_radio_audio' &&
                native === 'missing' &&
                !window.nativeAudioReady
              )
                throw new Error('Missing audio runtime');
              return false;
            },
          },
        };
    },
    {
      key: SETTINGS_KEY,
      settings: normalizeSettings({ onboarded: true }),
      radioKey: RADIO_KEY,
      preferences,
      native,
    }
  );
  await page.goto('/');
}
async function streams(page, count) {
  await page.route(stream, (route) => {
    count?.(route.request().url());
    return route.fulfill({
      body: audio,
      contentType: 'audio/wav',
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
}

test('opening and choosing radio is offline until play, with no account or native player required', async ({
  page,
}) => {
  const requests = [];
  await streams(page, (url) => requests.push(url));
  await start(page);
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: '舒缓', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.getByRole('button', { name: '静谧', exact: true }).click();
  expect(requests).toEqual([]);
  await expect(page.getByRole('group', { name: '电台频道' }).getByRole('button')).toHaveCount(3);
  await expect(page.locator('#music-panel select')).toHaveCount(0);
  await expect(page.locator('#music-help')).toBeHidden();
  await expect(page.getByRole('button', { name: '播放电台', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '播放电台', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('播放中');
  expect(requests).toEqual([STATIONS[1].url]);
  expect(
    await page.locator('#radio-stream').evaluate((el) => el.currentTime)
  ).toBeGreaterThanOrEqual(0);
  await page.getByRole('button', { name: '停止电台', exact: true }).click();
  await expect(page.locator('#radio-stream')).toHaveCount(0);
  await expect(page.locator('#music-status')).toHaveText('未播放');
});

test('changing channels keeps one stream and volume survives reload without autoplay', async ({
  page,
}) => {
  const requests = [];
  await streams(page, (url) => requests.push(url));
  await start(page);
  await page.keyboard.press('m');
  await page.locator('#music-volume').fill('18');
  await page.locator('#music-volume').dispatchEvent('change');
  await page.getByRole('button', { name: '播放电台', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('播放中');
  await page.getByRole('button', { name: '静谧', exact: true }).click();
  await expect(page.getByRole('button', { name: '静谧', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.locator('#music-status')).toHaveText('播放中');
  await expect(page.locator('#radio-stream')).toHaveCount(1);
  expect(await page.locator('#radio-stream').evaluate((el) => el.volume)).toBe(0.18);
  const before = requests.length;
  await page.reload();
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: '静谧', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.locator('#music-volume')).toHaveValue('18');
  await expect(page.locator('#music-status')).toHaveText('未播放');
  expect(requests.length).toBe(before);
});

test('collapsing controls leaves intentional playback running and Escape restores focus', async ({
  page,
}) => {
  await streams(page);
  await start(page);
  await page.keyboard.press('m');
  await page.getByRole('button', { name: '播放电台', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('播放中');
  await page.keyboard.press('Escape');
  await expect(page.locator('#music-panel')).toBeHidden();
  await expect(page.locator('#music-open')).toBeFocused();
  expect(await page.locator('#radio-stream').evaluate((el) => el.paused)).toBe(false);
  await page.keyboard.press('m');
  await expect(page.locator('#music-status')).toHaveText('播放中');
});

test('failed connections are reported and stopping cancels automatic recovery', async ({
  page,
}) => {
  let requests = 0;
  await page.route(stream, (route) => {
    requests++;
    return route.abort();
  });
  await start(page);
  await page.clock.install();
  await page.keyboard.press('m');
  await page.getByRole('button', { name: '播放电台', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('正在重连');
  await page.getByRole('button', { name: '停止电台', exact: true }).click();
  await page.clock.runFor(60000);
  expect(requests).toBe(1);
  await expect(page.locator('#music-status')).toHaveText('未播放');
  await expect(page.locator('#radio-stream')).toHaveCount(0);
});

test('a connection with no media response times out and can be canceled', async ({ page }) => {
  await page.route(stream, () => {});
  await start(page);
  await page.clock.install();
  await page.keyboard.press('m');
  await page.getByRole('button', { name: '播放电台', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText(/连接中|缓冲中/);
  await page.clock.runFor(15100);
  await expect(page.locator('#music-status')).toHaveText('正在重连');
  await page.getByRole('button', { name: '停止电台', exact: true }).click();
  await expect(page.locator('#radio-stream')).toHaveCount(0);
});

test('radio renders and plays under the actual desktop content policy', async ({ page }) => {
  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
  await page.route('**/index.html', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'Content-Security-Policy': config.app.security.csp },
    });
  });
  await streams(page);
  await start(page);
  await page.goto('/index.html');
  await page.keyboard.press('m');
  await page.getByRole('button', { name: '播放电台', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('播放中');
});

test('source uses a fixed native destination and stored invalid values are normalized', async ({
  page,
}) => {
  await start(page, { station: 'https://bad.example', volume: 8 }, true);
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: '舒缓', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.locator('#music-volume')).toHaveValue('100');
  await page.locator('#music-source').click();
  expect(
    await page.evaluate(() =>
      window.nativeCalls.filter((call) => call.command === 'open_radio_source')
    )
  ).toEqual([{ command: 'open_radio_source', args: {} }]);
});

test('a missing native audio runtime disables playback and can be checked again', async ({
  page,
}) => {
  const requests = [];
  await streams(page, (url) => requests.push(url));
  await start(page, {}, 'missing');
  await page.keyboard.press('m');
  await expect(page.locator('#music-status')).toHaveText('设备音频暂不可用');
  await expect(page.locator('#music-toggle')).toBeDisabled();
  expect(requests).toEqual([]);
  await expect(page.locator('#radio-stream')).toHaveCount(0);
  await page.evaluate(() => {
    window.nativeAudioReady = true;
  });
  await page.keyboard.press('Escape');
  await page.keyboard.press('m');
  await expect(page.locator('#music-toggle')).toBeEnabled();
});

test('radio layout fits empty and playing states at desktop, scaled and narrow sizes', async ({
  page,
}) => {
  await streams(page);
  await start(page, {}, true);
  await page.keyboard.press('m');
  for (const playing of [false, true]) {
    if (playing) {
      await page.getByRole('button', { name: '播放电台', exact: true }).click();
      await expect(page.locator('#music-status')).toHaveText('播放中');
    }
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [1280, 720],
      [1408, 792],
      [800, 1280],
      [390, 844],
      [360, 740],
      [360, 540],
      [960, 540],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(
        ({ width, height }) =>
          parseFloat(document.documentElement.style.getPropertyValue('--app-vw')) === width / 100 &&
          parseFloat(document.documentElement.style.getPropertyValue('--app-vh')) === height / 100,
        { width, height }
      );
      expect(
        await page.evaluate(() => [
          document.documentElement.scrollWidth,
          document.documentElement.scrollHeight,
        ]),
        `${width}x${height}; ${playing}`
      ).toEqual([width, height]);
      const panel = page.getByRole('dialog', { name: '网络电台' });
      expect((await panel.boundingBox()).height).toBe(height);
      for (const control of [
        '#music-toggle',
        '#music-channels',
        '#music-volume',
        '#music-close',
        '#music-source',
        '#music-motion',
      ])
        await expect(page.locator(control)).toBeInViewport({ ratio: 0.999 });
      expect(await panel.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    }
  }
});

test('listening room contains focus, returns to the clock and does not expose background shortcuts', async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press('m');
  await expect(page.getByRole('dialog', { name: '网络电台' })).toBeVisible();
  await expect(page.locator('.clock-shell')).toHaveAttribute('inert', '');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#music-motion')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#music-close')).toBeFocused();
  await page.keyboard.press('s');
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#music-open')).toBeFocused();
  await expect(page.locator('.clock-shell')).not.toHaveAttribute('inert', '');
});

test('ambient motion respects reduced motion, can be enabled and pauses when closed', async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press('m');
  const panel = page.locator('#music-panel');
  await expect(panel).toHaveAttribute('data-renderer', 'webgl');
  await expect(panel).toHaveAttribute('data-animating', 'false');
  await page.getByRole('button', { name: '开启动效', exact: true }).click();
  await expect(panel).toHaveAttribute('data-animating', 'true');
  const before = Number(await panel.getAttribute('data-frames'));
  await expect
    .poll(async () => Number(await panel.getAttribute('data-frames')))
    .toBeGreaterThan(before + 2);
  await page.getByRole('button', { name: '暂停画面动效', exact: true }).click();
  const stopped = await panel.getAttribute('data-frames');
  await page.waitForTimeout(150);
  expect(await panel.getAttribute('data-frames')).toBe(stopped);
  await page.getByRole('button', { name: '开启动效', exact: true }).click();
  await page.keyboard.press('Escape');
  const closed = await panel.getAttribute('data-frames');
  await page.waitForTimeout(150);
  expect(await panel.getAttribute('data-frames')).toBe(closed);
  await page.keyboard.press('m');
  await expect(panel).toHaveAttribute('data-animating', 'true');
  await page.getByRole('button', { name: '静谧', exact: true }).click();
  await expect(page.locator('#music-title')).toHaveText('静谧');
  await expect(page.locator('#music-subtitle')).toHaveText('Serenity');
});

test('radio remains usable with a real poster when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl') return null;
      return original.call(this, type, ...args);
    };
  });
  await streams(page);
  await start(page);
  await page.keyboard.press('m');
  await expect(page.locator('#music-panel')).toHaveAttribute('data-renderer', 'poster');
  await expect
    .poll(() => page.locator('.music-poster').evaluate((img) => img.naturalWidth))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '随心', exact: true }).click();
  await page.getByRole('button', { name: '播放电台', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('播放中');
  await page.getByRole('button', { name: '停止电台', exact: true }).click();
  await expect(page.locator('#radio-stream')).toHaveCount(0);
});

test('graphics context loss falls back without interrupting playback and restores rendering', async ({
  page,
}) => {
  await streams(page);
  await start(page);
  await page.keyboard.press('m');
  await page.getByRole('button', { name: '播放电台', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('播放中');
  await page.evaluate(() => {
    window.lostGraphics = document
      .querySelector('canvas')
      .getContext('webgl')
      .getExtension('WEBGL_lose_context');
    window.lostGraphics.loseContext();
  });
  await expect(page.locator('#music-panel')).toHaveAttribute('data-renderer', 'poster');
  await expect(page.locator('#music-status')).toHaveText('播放中');
  await page.evaluate(() => window.lostGraphics.restoreContext());
  await expect(page.locator('#music-panel')).toHaveAttribute('data-renderer', 'webgl');
});
