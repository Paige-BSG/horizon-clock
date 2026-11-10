import { test, expect } from '@playwright/test';
import { normalizeSettings, SETTINGS_KEY } from '../../lib/settings.js';

async function start(page, loggedIn = true, longPlaylist = false) {
  await page.addInitScript(
    ({ key, settings, loggedIn, longPlaylist }) => {
      localStorage.setItem(key, JSON.stringify(settings));
      const tracks = [
        { id: '11', name: '测试歌曲甲', artist: '测试歌手', duration: 173 },
        { id: '12', name: '测试歌曲乙', artist: '测试歌手', duration: 200 },
      ];
      if (longPlaylist) {
        const first = tracks[0];
        tracks.push(
          ...Array.from({ length: 98 }, (_, i) => ({
            ...first,
            id: String(100 + i),
            name: `测试歌曲 ${i + 3}`,
          }))
        );
      }
      const idle = () => ({ state: 'stopped', track: null, seconds: 0, duration: 0, volume: 50 });
      const view = {
        authenticated: loggedIn,
        login: loggedIn ? 'ready' : 'idle',
        qr: null,
        playlists: loggedIn ? [{ id: '21', name: '测试歌单', count: tracks.length }] : [],
        playlist: null,
        tracks: [],
        total: 0,
        playback: idle(),
      };
      window.nativeCalls = [];
      window.__TAURI__ = {
        core: {
          invoke: async (command, args) => {
            window.nativeCalls.push({ command, args });
            if (command !== 'netease') return command === 'radio_audio_levels' ? [] : false;
            const a = args.action;
            if (window.failAction === a.type) throw '当前账号无法播放此歌曲';
            if (a.type === 'restore' && window.delayRestore)
              await new Promise((r) => {
                window.finishRestore = r;
              });
            if (a.type === 'tracks') {
              view.tracks = tracks;
              view.playlist = a.playlist;
              view.total = tracks.length;
            }
            if (a.type === 'play') {
              const track = tracks.find((t) => t.id === a.id);
              view.playback = {
                state: 'playing',
                track,
                seconds: 1,
                duration: track.duration,
                volume: view.playback.volume,
              };
            }
            if (a.type === 'pause') view.playback.state = a.paused ? 'paused' : 'playing';
            if (a.type === 'volume') view.playback.volume = a.volume;
            if (a.type === 'stop') {
              if (window.delayStop)
                await new Promise((r) => {
                  window.finishStop = r;
                });
              view.playback = idle();
            }
            if (a.type === 'login') {
              view.login = 'waiting';
              view.qr =
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1X8AAAAASUVORK5CYII=';
            }
            if (a.type === 'cancel_login') {
              view.login = 'idle';
              view.qr = null;
            }
            if (a.type === 'poll_login') {
              view.login = 'expired';
              view.qr = null;
            }
            if (a.type === 'logout') {
              view.authenticated = false;
              view.login = 'idle';
              view.playlists = [];
              view.tracks = [];
              view.playback = idle();
            }
            if (a.type === 'status' && window.endTrack) {
              view.playback.state = 'ended';
              window.endTrack = false;
            }
            return structuredClone(view);
          },
        },
      };
    },
    {
      key: SETTINGS_KEY,
      settings: normalizeSettings({ weatherEnabled: false, autoNight: false }),
      loggedIn,
      longPlaylist,
    }
  );
  await page.goto('/');
  await page.keyboard.press('m');
  await page.locator('#music-netease').click();
  await expect(page.locator('#netease-account-status')).toHaveText(loggedIn ? '已登录' : '未登录');
}
async function choose(page) {
  await page.locator('#netease-playlists').selectOption('21');
  await expect(page.locator('#netease-tracks button')).toHaveCount(2);
}

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
  await expect(page.locator('#music-channels')).toBeHidden();
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

test('switching source waits for native stop and preserves radio explicit-play behavior', async ({
  page,
}) => {
  await start(page);
  await choose(page);
  await page.locator('#netease-tracks button').first().click();
  await page.evaluate(() => {
    window.delayStop = true;
  });
  await page.locator('#music-radio').click();
  await expect(page.locator('#music-radio')).toBeDisabled();
  await expect(page.getByRole('button', { name: '播放电台', exact: true })).toHaveCount(0);
  await page.waitForFunction(() => !!window.finishStop);
  await page.evaluate(() => window.finishStop());
  await expect(page.getByRole('button', { name: '播放电台', exact: true })).toBeEnabled();
  await expect(page.locator('#netease-library')).toBeHidden();
  await expect(page.locator('#music-status')).toHaveText('未播放');
});

test('QR is in-app, expires without regeneration, and can be canceled', async ({ page }) => {
  await start(page, false);
  await page.locator('#netease-connect').click();
  await expect(page.locator('#netease-qr')).toBeVisible();
  await expect(page.locator('#netease-qr')).toBeHidden({ timeout: 5000 });
  await expect(page.locator('#music-help')).toHaveText('二维码已过期');
  expect(
    await page.evaluate(
      () => window.nativeCalls.filter((c) => c.args?.action?.type === 'login').length
    )
  ).toBe(1);
  await page.locator('#netease-connect').click();
  await page.locator('#netease-cancel').click();
  await expect(page.locator('#netease-qr')).toBeHidden();
  await expect(page.locator('#music-help')).toBeHidden();
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
  await page.locator('#music-netease').click();
  await expect(page.locator('#netease-account-status')).toHaveText('桌面版可用');
  await expect(page.locator('#netease-connect')).toBeHidden();
  await expect(page.locator('#music-toggle')).toBeDisabled();
});

test('readable text keeps a long library scrollable and native playback controls visible', async ({
  page,
}) => {
  await start(page, true, true);
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
    const art = await page.locator('.music-art').boundingBox();
    expect(art.height).toBeGreaterThanOrEqual(47);
    expect(
      await page
        .locator('#netease-tracks button small')
        .first()
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
    ).toBeGreaterThanOrEqual(13);
    await page.screenshot({ path: `/tmp/horizon-type-library-${width}.png` });
  }
});
