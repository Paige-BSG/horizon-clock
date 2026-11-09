import { test, expect } from '@playwright/test';
import { normalizeSettings, SETTINGS_KEY } from '../../lib/settings.js';

const player = (id = 'netease', extra = {}) => ({
  id: `org.mpris.MediaPlayer2.${id}`,
  owner: id === 'netease' ? ':1.22' : ':1.23',
  name: id === 'netease' ? '网易云音乐' : '另一个播放器',
  title: '测试歌曲',
  artist: '测试歌手',
  status: 'Playing',
  canToggle: true,
  canPrevious: true,
  canNext: true,
  ...extra,
});

async function start(page, players = [player()], desktop = true) {
  await page.addInitScript(
    ({ settingsKey, settings, initial, desktop }) => {
      localStorage.setItem(settingsKey, JSON.stringify(settings));
      window.mediaTest = { players: initial, calls: [], fail: false, failPoll: false, delay: 0 };
      if (desktop)
        window.__TAURI__ = {
          core: {
            async invoke(command, args) {
              const state = window.mediaTest;
              if (command === 'get_media_players') {
                state.calls.push({ command });
                const snapshot = structuredClone({ supported: true, players: state.players });
                if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
                if (state.failPoll) throw new Error('test failure');
                return snapshot;
              }
              if (command === 'control_media') {
                state.calls.push({ command, ...args });
                if (state.controlDelay)
                  await new Promise((resolve) => setTimeout(resolve, state.controlDelay));
                if (state.fail) throw new Error('test failure');
                const target = state.players.find(
                  (item) => item.id === args.player && item.owner === args.owner
                );
                if (!target) throw new Error('disconnected');
                if (args.action === 'toggle')
                  target.status = target.status === 'Playing' ? 'Paused' : 'Playing';
                if (args.action === 'next') target.title = '下一首测试歌曲';
                return;
              }
              if (command === 'get_autostart' || command === 'get_fullscreen') return false;
              return false;
            },
          },
        };
    },
    {
      settingsKey: SETTINGS_KEY,
      settings: normalizeSettings({ onboarded: true }),
      initial: players,
      desktop,
    }
  );
  await page.goto('/');
}

test('controls stay on the clock, target the selected player, and read back state', async ({
  page,
}) => {
  await start(page);
  expect(await page.evaluate(() => window.mediaTest.calls)).toEqual([]);
  await page.getByRole('button', { name: '音乐控制', exact: true }).click();
  await expect(page.locator('#music-title')).toHaveText('测试歌曲');
  await expect(page.locator('#music-artist')).toHaveText('测试歌手 · 网易云音乐');
  await page.getByRole('button', { name: '暂停音乐', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('已暂停');
  await page.getByRole('button', { name: '播放音乐', exact: true }).click();
  await expect(page.locator('#music-status')).toHaveText('正在播放');
  await page.getByRole('button', { name: '下一首', exact: true }).click();
  await expect(page.locator('#music-title')).toHaveText('下一首测试歌曲');
  await page.getByRole('button', { name: '上一首', exact: true }).click();
  const commands = await page.evaluate(() =>
    window.mediaTest.calls.filter((call) => call.command === 'control_media')
  );
  expect(commands.map((call) => call.action)).toEqual(['toggle', 'toggle', 'next', 'previous']);
  expect(
    commands.every(
      (call) => call.player === 'org.mpris.MediaPlayer2.netease' && call.owner === ':1.22'
    )
  ).toBe(true);
  await expect(page.locator('#hours')).not.toHaveText('--');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('multiple players require selection and losing a player never targets another', async ({
  page,
}) => {
  await start(page, [player(), player('browser')]);
  await page.keyboard.press('m');
  await expect(page.locator('#music-help')).toHaveText(/多个播放器/);
  await expect(page.locator('#music-toggle')).toBeDisabled();
  await page.locator('#music-player').selectOption('org.mpris.MediaPlayer2.netease|:1.22');
  await expect(page.locator('#music-toggle')).toBeEnabled();
  await page.evaluate(() => {
    window.mediaTest.players.shift();
  });
  await expect(page.locator('#music-artist')).toHaveText('播放器已断开连接', { timeout: 6000 });
  await expect(page.locator('#music-toggle')).toBeDisabled();
  await page.locator('#music-player').selectOption('org.mpris.MediaPlayer2.browser|:1.23');
  await page.getByRole('button', { name: '暂停音乐', exact: true }).click();
  expect(
    await page.evaluate(
      () => window.mediaTest.calls.find((call) => call.command === 'control_media').player
    )
  ).toBe('org.mpris.MediaPlayer2.browser');
});

test('capabilities disable unsupported actions and errors never claim success', async ({
  page,
}) => {
  await start(page, [player('netease', { canNext: false, canPrevious: false })]);
  await page.keyboard.press('m');
  await expect(page.locator('#music-next')).toBeDisabled();
  await expect(page.locator('#music-previous')).toBeDisabled();
  await page.evaluate(() => {
    window.mediaTest.fail = true;
  });
  await page.getByRole('button', { name: '暂停音乐', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText(/音乐控制未完成/);
  await expect(page.locator('#music-status')).toHaveText('正在播放');
  await expect(page.locator('#music-toggle')).toBeEnabled();
});

test('rapid repeated input sends only one command until readback completes', async ({ page }) => {
  await start(page);
  await page.keyboard.press('m');
  await expect(page.locator('#music-title')).toHaveText('测试歌曲');
  await page.evaluate(() => {
    window.mediaTest.controlDelay = 350;
  });
  await page.getByRole('button', { name: '暂停音乐', exact: true }).dblclick();
  await expect(page.locator('#music-status')).toHaveText('已暂停');
  expect(
    await page.evaluate(
      () => window.mediaTest.calls.filter((call) => call.command === 'control_media').length
    )
  ).toBe(1);
});

test('an older in-flight poll cannot overwrite command readback', async ({ page }) => {
  await start(page);
  await page.keyboard.press('m');
  await expect(page.locator('#music-title')).toHaveText('测试歌曲');
  await page.evaluate(() => {
    window.mediaTest.delay = 500;
  });
  await page.waitForFunction(
    () => window.mediaTest.calls.filter((call) => call.command === 'get_media_players').length > 1
  );
  await page.getByRole('button', { name: '下一首', exact: true }).click();
  await expect(page.locator('#music-title')).toHaveText('下一首测试歌曲');
  await expect(page.locator('#music-toggle')).toBeEnabled();
});

test('browser preview explains desktop requirement without fake controls', async ({ page }) => {
  await start(page, [], false);
  await page.keyboard.press('m');
  await expect(page.locator('#music-help')).toHaveText(/浏览器预览无法控制/);
  await expect(page.locator('#music-toggle')).toBeDisabled();
});

test('no player and reconnection stay honest, including a changed process owner', async ({
  page,
}) => {
  await start(page, []);
  await page.keyboard.press('m');
  await expect(page.locator('#music-help')).toHaveText(/同一台设备/);
  await expect(page.locator('#music-toggle')).toBeDisabled();
  await page.evaluate((p) => {
    window.mediaTest.players = [p];
  }, player());
  await expect(page.locator('#music-title')).toHaveText('测试歌曲', { timeout: 6000 });
  await page.evaluate(() => {
    window.mediaTest.players[0].owner = ':1.99';
  });
  await expect(page.locator('#music-artist')).toHaveText('播放器已断开连接', { timeout: 6000 });
  await expect(page.locator('#music-toggle')).toBeDisabled();
  await page.locator('#music-player').selectOption('org.mpris.MediaPlayer2.netease|:1.99');
  await expect(page.locator('#music-toggle')).toBeEnabled();
  await page.locator('#music-player').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#music-panel')).toBeHidden();
});

test('a closed or hidden panel stops polling and discards late results', async ({ page }) => {
  await start(page);
  await page.keyboard.press('m');
  await expect(page.locator('#music-title')).toHaveText('测试歌曲');
  await page.evaluate(() => {
    window.mediaTest.delay = 500;
  });
  await page.getByRole('button', { name: '收起音乐控制' }).click();
  const calls = await page.evaluate(() => window.mediaTest.calls.length);
  await page.waitForTimeout(3300);
  expect(await page.evaluate(() => window.mediaTest.calls.length)).toBe(calls);
  await expect(page.locator('#music-panel')).toBeHidden();
  await page.keyboard.press('m');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(600);
  const hiddenCalls = await page.evaluate(() => window.mediaTest.calls.length);
  await page.waitForTimeout(3300);
  expect(await page.evaluate(() => window.mediaTest.calls.length)).toBe(hiddenCalls);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.mediaTest.players[0].title = '恢复后的歌曲';
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#music-title')).toHaveText('恢复后的歌曲');
  await page.keyboard.press('Escape');
  await expect(page.locator('#music-panel')).toBeHidden();
  await expect(page.locator('#music-open')).toBeFocused();
});

test('connection failures disable stale controls and recover automatically', async ({ page }) => {
  await start(page);
  await page.keyboard.press('m');
  await expect(page.locator('#music-title')).toHaveText('测试歌曲');
  await page.evaluate(() => {
    window.mediaTest.failPoll = true;
  });
  await expect(page.locator('#music-artist')).toHaveText('暂时无法连接系统媒体服务', {
    timeout: 6000,
  });
  await expect(page.locator('#music-toggle')).toBeDisabled();
  await page.evaluate(() => {
    window.mediaTest.failPoll = false;
  });
  await expect(page.locator('#music-title')).toHaveText('测试歌曲', { timeout: 6000 });
});

test('long metadata is text only and music fits desktop, scaled and mobile layouts', async ({
  page,
}) => {
  await start(page, [
    player('netease', {
      title: '<img src=x onerror=alert(1)>' + '长歌名'.repeat(100),
      artist: '长歌手名'.repeat(100),
    }),
  ]);
  await page.keyboard.press('m');
  await expect(page.locator('#music-title')).toHaveText(/<img/);
  await expect(page.locator('#music-title img')).toHaveCount(0);
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [1280, 720],
    [1408, 792],
    [800, 1280],
    [390, 844],
    [360, 740],
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
      `${width}x${height}`
    ).toEqual([width, height]);
    await expect(page.locator('#music-toggle')).toBeInViewport();
    await expect(page.locator('#night-toggle')).toBeInViewport();
  }
});
