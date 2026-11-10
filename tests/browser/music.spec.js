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
      settings: normalizeSettings({ weatherEnabled: false, autoNight: false, city: '东京' }),
      radioKey: RADIO_KEY,
      preferences,
      native,
    }
  );
  await page.goto('/');
}
async function streams(page, count, body = audio) {
  await page.route(stream, (route) => {
    count?.(route.request().url());
    return route.fulfill({
      body,
      contentType: 'audio/wav',
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
}

async function changeMotion(page, label) {
  await page.mouse.move(0, 0);
  await page.mouse.move(1, 1);
  await page.locator('#settings-open').click();
  await page.getByRole('tab', { name: '显示', exact: true }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('button', { name: '完成设置', exact: true }).click();
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
  await expect(page.locator('#netease-playlists')).toBeHidden();
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
  await page.locator('#settings-open').click();
  await page.getByRole('tab', { name: '应用', exact: true }).click();
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

test('split music mode retains clock, date and weather with a 4:6 desktop composition', async ({
  page,
}) => {
  await streams(page);
  await start(page, {}, true);
  await page.keyboard.press('m');
  for (const [width, height] of [
    [1440, 900],
    [1408, 792],
    [1280, 720],
    [960, 540],
    [800, 1280],
    [390, 844],
    [360, 740],
    [360, 540],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction((w) => innerWidth === w, width);
    for (const selector of ['.time-section', '.date-panel', '.weather-panel', '#music-panel'])
      await expect(page.locator(selector)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const player = await page.locator('#music-panel').boundingBox(),
      clock = await page.locator('.clock-information').boundingBox();
    if (width > 740) {
      expect(player.x + player.width).toBeLessThan(clock.x);
      expect(player.width / clock.width).toBeCloseTo(2 / 3, 1);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
      for (const selector of [
        '.time-section',
        '.date-panel',
        '.weather-panel',
        '#music-toggle',
        '#music-volume',
        '#music-channels',
      ])
        await expect(page.locator(selector)).toBeInViewport({ ratio: 0.999 });
    } else expect(clock.y).toBeLessThan(player.y);
  }
  await page.setViewportSize({ width: 1408, height: 792 });
  await page.getByRole('button', { name: '播放电台', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('播放中');
  await expect(page.locator('.time-section')).toBeInViewport({ ratio: 0.999 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#music-open')).toBeFocused();
  await expect(page.locator('#music-panel')).toBeHidden();
});

test('clock controls remain usable beside the player and closing restores the original view', async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press('m');
  await expect(page.locator('.clock-shell')).not.toHaveAttribute('inert', '');
  await page.keyboard.press('s');
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#music-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#music-panel')).toBeHidden();
  await expect(page.locator('.time-section')).toBeVisible();
  await expect(page.locator('.weather-panel')).toBeVisible();
});

test('silent audio has no invented beat and motion stops when paused or collapsed', async ({
  page,
}) => {
  await streams(page);
  await start(page);
  await page.keyboard.press('m');
  const panel = page.locator('#music-panel');
  await expect(panel).toHaveAttribute('data-animating', 'false');
  await page.getByRole('button', { name: '播放电台', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('播放中');
  await changeMotion(page, '开启声纹动效');
  const before = Number(await panel.getAttribute('data-frames'));
  await expect
    .poll(async () => Number(await panel.getAttribute('data-frames')))
    .toBeGreaterThan(before + 4);
  expect(Number(await panel.getAttribute('data-audio-rms'))).toBe(0);
  expect(Number(await panel.getAttribute('data-energy'))).toBe(0);
  expect(Number(await panel.getAttribute('data-wave-peak'))).toBe(0);
  await changeMotion(page, '暂停声纹动效');
  const paused = await panel.getAttribute('data-frames');
  await page.waitForTimeout(120);
  expect(await panel.getAttribute('data-frames')).toBe(paused);
  await changeMotion(page, '开启声纹动效');
  await page.keyboard.press('Escape');
  const closed = await panel.getAttribute('data-frames');
  await page.waitForTimeout(120);
  expect(await panel.getAttribute('data-frames')).toBe(closed);
  expect(await page.locator('#radio-stream').evaluate((a) => a.paused)).toBe(false);
});

test('waveform follows decoded audio and becomes a straight line when muted or stopped', async ({
  page,
}) => {
  const tone = Buffer.from(audio);
  for (let i = 0; i < samples; i++) {
    const t = i / 8000,
      envelope = 0.08 + 0.07 * Math.sin(t * Math.PI * 4);
    tone.writeInt16LE(Math.round(Math.sin(t * Math.PI * 220) * envelope * 32767), 44 + i * 2);
  }
  await streams(page, undefined, tone);
  await start(page);
  await page.keyboard.press('m');
  await page.getByRole('button', { name: '播放电台', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('播放中');
  await changeMotion(page, '开启声纹动效');
  await expect
    .poll(async () => Number(await page.locator('#music-panel').getAttribute('data-audio-rms')))
    .toBeGreaterThan(0.005);
  await expect
    .poll(async () => Number(await page.locator('#music-panel').getAttribute('data-wave-peak')))
    .toBeGreaterThan(0.01);
  const values = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(80);
    values.push(Number(await page.locator('#music-panel').getAttribute('data-energy')));
  }
  expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.015);
  await page.locator('#music-volume').fill('0');
  await expect
    .poll(async () => Number(await page.locator('#music-panel').getAttribute('data-energy')))
    .toBeLessThan(0.005);
  expect(Number(await page.locator('#music-panel').getAttribute('data-wave-peak'))).toBe(0);
  await expect(page.locator('#music-analysis')).toBeHidden();
  await page.getByRole('button', { name: '停止电台', exact: true }).click();
  await expect
    .poll(async () => Number(await page.locator('#music-panel').getAttribute('data-energy')))
    .toBeLessThan(0.005);
  await expect(page.locator('#radio-stream')).toHaveCount(0);
});

test('playback and clock survive an unavailable waveform canvas', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = function () {
      return null;
    };
  });
  await streams(page);
  await start(page);
  await page.keyboard.press('m');
  await expect(page.locator('#music-panel')).toHaveAttribute('data-renderer', 'none');
  await expect(page.locator('.time-section')).toBeVisible();
  await page.getByRole('button', { name: '播放电台', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('播放中');
  await page.getByRole('button', { name: '停止电台', exact: true }).click();
  await expect(page.locator('#radio-stream')).toHaveCount(0);
});

test('music clock fits the logical display when native viewport units differ under font scaling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await start(page, {}, true);
  await page.keyboard.press('m');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-vw', '14.08px');
    document.documentElement.style.setProperty('--app-vh', '7.92px');
  });
  const size = await page
    .locator('.main-time')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeLessThan(220);
  expect(size).toBeGreaterThan(180);
});

test('an idle waveform is a straight line and does not continuously redraw', async ({ page }) => {
  await start(page);
  await page.keyboard.press('m');
  const panel = page.locator('#music-panel');
  await expect(panel).toHaveAttribute('data-renderer', 'waveform');
  await expect(panel).toHaveAttribute('data-wave-peak', '0');
  await expect(panel).toHaveAttribute('data-animating', 'false');
  const frames = await panel.getAttribute('data-frames');
  await page.waitForTimeout(150);
  expect(await panel.getAttribute('data-frames')).toBe(frames);
});
