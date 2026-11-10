import { test, expect } from '@playwright/test';
import { start, choose, sourceAction } from './music-fixture.js';
const played = (page) =>
  page.evaluate(() =>
    window.nativeCalls.filter((c) => c.args?.action?.type === 'play').map((c) => c.args.action.id)
  );
async function eof(page) {
  await page.evaluate(() => (window.endTrack = true));
}

test('mode is remembered without autoplay; single repeat keeps EOF on the same track, Next still advances', async ({
  page,
}) => {
  await start(page);
  await choose(page);
  await page.locator('#netease-tracks button').first().click();
  await expect(page.locator('#music-repeat')).toHaveAttribute('aria-label', '循环模式：列表循环');
  await page.locator('#music-repeat').click();
  await expect(page.locator('#music-repeat')).toHaveAttribute('aria-label', '循环模式：单曲循环');
  await eof(page);
  await expect.poll(async () => (await played(page)).length).toBe(2);
  expect(await played(page)).toEqual(['11', '11']);
  await page.locator('#netease-next').click();
  await expect(page.locator('#music-title')).toHaveText('测试歌曲乙');
  await page.reload();
  await page.keyboard.press('m');
  await expect(page.locator('#music-repeat')).toHaveAttribute('aria-label', '循环模式：单曲循环');
  expect(await played(page)).toEqual([]);
});
test('list loop wraps, sequential ends, and empty playback never starts by switching modes', async ({
  page,
}) => {
  await start(page);
  await page.locator('#music-repeat').click();
  expect(await played(page)).toEqual([]);
  await choose(page);
  await page.locator('#netease-tracks button').last().click();
  await page.locator('#music-repeat').click();
  await eof(page);
  await expect(page.locator('#music-status')).toHaveText('已播完');
  expect(await played(page)).toEqual(['12']);
  await page.locator('#music-repeat').click();
  await page.locator('#music-toggle').click();
  await eof(page);
  await expect.poll(async () => (await played(page)).at(-1)).toBe('11');
});
test('shuffle includes unloaded pages and Previous returns to the song actually played', async ({
  page,
}) => {
  await page.addInitScript(() => (Math.random = () => 0.99999));
  await start(page, true, true);
  await page.evaluate(
    () =>
      (window.extraTracks = [{ id: '999', name: '末页歌曲', artist: '测试歌手', duration: 180 }])
  );
  await sourceAction(page, 'music-library-toggle');
  await page.locator('#netease-playlists').selectOption('21');
  await page.locator('#music-shuffle').click();
  await page.locator('#netease-tracks button').first().click();
  await page.locator('#netease-next').click();
  await expect(page.locator('#music-title')).toHaveText('末页歌曲');
  await expect(page.locator('#netease-tracks button')).toHaveCount(101);
  await page.locator('#netease-next').click();
  const ids = await played(page);
  expect(ids[2]).not.toBe(ids[1]);
  await page.locator('#netease-previous').click();
  await expect(page.locator('#music-title')).toHaveText('末页歌曲');
  await page.locator('#netease-next').click();
  expect((await played(page)).at(-1)).toBe(ids[2]);
});
test('personal recommendations continue with another batch and returning to a playlist restores the chosen mode', async ({
  page,
}) => {
  await start(page);
  await page.locator('#music-repeat').click();
  await sourceAction(page, 'music-fm');
  await expect(page.locator('#music-title')).toHaveText('推荐歌曲 1-1');
  await expect(page.locator('#music-repeat')).toBeDisabled();
  await page.locator('#netease-next').click();
  await eof(page);
  await expect(page.locator('#music-title')).toHaveText('推荐歌曲 2-1');
  expect(await page.evaluate(() => window.fmBatches)).toBe(2);
  await page.locator('#netease-previous').click();
  await expect(page.locator('#music-title')).toHaveText('推荐歌曲 1-2');
  await choose(page);
  await expect(page.locator('#music-repeat')).toBeEnabled();
  await expect(page.locator('#music-repeat')).toHaveAttribute('aria-label', '循环模式：单曲循环');
});
test('recommendation errors are visible, do not replace the playing song, and never trigger a fallback', async ({
  page,
}) => {
  await start(page);
  await choose(page);
  await page.locator('#netease-tracks button').first().click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window.failAction = 'fm'));
  await sourceAction(page, 'music-fm');
  await expect(page.locator('#music-help')).toBeVisible();
  await expect(page.locator('#music-title')).toHaveText('测试歌曲甲');
  await expect(page.locator('#music-status')).toHaveText('播放中');
  expect(await played(page)).toEqual(['11']);
});

test('sequential playback loads the next playlist page before stopping at the true end', async ({
  page,
}) => {
  await start(page, true, true);
  await page.evaluate(
    () =>
      (window.extraTracks = [{ id: '999', name: '最后一页', artist: '测试歌手', duration: 180 }])
  );
  await page.locator('#music-repeat').click();
  await page.locator('#music-repeat').click();
  await sourceAction(page, 'music-library-toggle');
  await page.locator('#netease-playlists').selectOption('21');
  await page.locator('#netease-tracks button').last().click();
  await eof(page);
  await expect(page.locator('#music-title')).toHaveText('最后一页');
  await eof(page);
  await expect(page.locator('#music-status')).toHaveText('已播完');
  expect((await played(page)).length).toBe(2);
});

test('shuffle and repeat have independent state, restore together, and never start playback', async ({
  page,
}) => {
  await start(page);
  await page.locator('#music-shuffle').click();
  await page.locator('#music-repeat').click();
  await expect(page.locator('#music-shuffle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#music-repeat-icon')).toHaveAttribute('href', '#icon-one');
  expect(await played(page)).toEqual([]);
  await choose(page);
  await page.locator('#netease-tracks button').first().click();
  await eof(page);
  await expect.poll(async () => (await played(page)).length).toBe(2);
  expect(await played(page)).toEqual(['11', '11']);
  await page.locator('#netease-next').click();
  await expect(page.locator('#music-title')).toHaveText('测试歌曲乙');
  await page.reload();
  await page.keyboard.press('m');
  await expect(page.locator('#music-repeat')).toHaveAttribute('aria-label', '循环模式：单曲循环');
  await expect(page.locator('#music-shuffle')).toHaveAttribute('aria-pressed', 'true');
  expect(await played(page)).toEqual([]);
});
