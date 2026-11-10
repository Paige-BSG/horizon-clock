import { test, expect, chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { normalizeSettings, SETTINGS_KEY } from '../../lib/settings.js';
import { NOW } from '../fixtures.js';
const api = 'https://commons.wikimedia.org/w/api.php**';
const jpeg = await readFile('assets/landscapes/lake.jpg');
// Decoding, resizing and saving 24 images can exceed 5s on shared CI runners.
const cacheExpect = expect.configure({ timeout: 15000 });
function imagePage(id) {
  return {
    pageid: id,
    title: `File:风景 ${id}.jpg`,
    imageinfo: [
      {
        width: 3000,
        height: 2000,
        mime: 'image/jpeg',
        sha1: 'a'.repeat(40),
        thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1920px-${id}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${id}.jpg`,
        extmetadata: {
          Artist: { value: '<b>Fixture Photographer</b>' },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
        },
      },
    ],
  };
}
async function mock(context, state = { base: 300000001, requests: 0, images: 0 }) {
  await context.route(api, (route) => {
    state.requests++;
    if (state.fail) return route.abort();
    const params = new URL(route.request().url()).searchParams;
    const ids = Array.from({ length: 30 }, (_, i) => state.base + i);
    return route.fulfill({
      json: params.get('list')
        ? { query: { categorymembers: ids.map((pageid) => ({ pageid })) } }
        : { query: { pages: Object.fromEntries(ids.map((id) => [id, imagePage(id)])) } },
    });
  });
  await context.route('https://thumb.wikimedia.org/**', (route) => {
    state.images++;
    if (state.fail) return route.abort();
    return route.fulfill({ body: jpeg, contentType: 'image/jpeg' });
  });
  return state;
}
async function start(page) {
  await page.clock.install({ time: new Date(NOW) });
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: SETTINGS_KEY,
      value: normalizeSettings({
        weatherEnabled: false,
        autoNight: false,
        city: '东京',
        rotate: false,
      }),
    }
  );
  await page.goto('/');
}
async function open(page) {
  // Real pointer movement wakes the toolbar after the simulated day of inactivity.
  await page.mouse.move(0, 0);
  await page.mouse.move(1, 1);
  await page.locator('#settings-open').click();
  await page.getByRole('tab', { name: '背景', exact: true }).click();
  await page.locator('#background-open').click();
}
async function openAttribution(page) {
  if (await page.locator('#background-picker').isVisible())
    await page.locator('#picker-close').click();
  if (!(await page.locator('#settings-dialog').isVisible())) {
    await page.mouse.move(0, 0);
    await page.mouse.move(1, 1);
    await page.locator('#settings-open').click();
  }
  await page.getByRole('tab', { name: '背景', exact: true }).click();
  await page.locator('#image-source').click();
}
async function enable(page) {
  await open(page);
  await page.locator('#online-gallery-toggle').click();
  await cacheExpect(page.locator('#online-gallery-status')).toContainText('24 张在线风景已缓存');
}

test('21 bundled landscapes work offline, show matching credits and make no background requests', async ({
  page,
}) => {
  const state = await mock(page);
  await start(page);
  await open(page);
  await expect(page.locator('#quick-builtin-scenes [data-quick-scene]')).toHaveCount(21);
  await page.getByRole('button', { name: '使用阳朔峰林', exact: true }).click();
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /54739240.jpg/);
  await expect(page.locator('#scene-credit')).toContainText('Chensiyuan');
  await openAttribution(page);
  await expect(page.locator('#photo-source-license')).toContainText('CC BY-SA 4.0');
  await expect(page.locator('#photo-source-link')).toHaveAttribute(
    'href',
    /commons.wikimedia.org\/wiki\/File:/
  );
  expect(state.requests + state.images).toBe(0);
});

test('consent downloads 24 licensed images, selection and source survive offline reload', async ({
  page,
}) => {
  const state = await mock(page);
  await start(page);
  await enable(page);
  expect(state.requests).toBe(2);
  expect(state.images).toBe(24);
  await page.locator('[data-quick-scene="commons:300000001"]').click();
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('#scene-credit')).toContainText('Fixture Photographer');
  state.fail = true;
  await page.reload();
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('#scene-credit')).toContainText('CC BY-SA 4.0');
  expect(state.images).toBe(24);
});

test('checking an unchanged catalog reuses all 24 local images', async ({ page }) => {
  const state = await mock(page);
  await start(page);
  await enable(page);
  await page.clock.fastForward(60001);
  await page.locator('#online-gallery-refresh').click();
  await expect.poll(() => state.requests).toBe(4);
  await cacheExpect(page.locator('#online-gallery-status')).toContainText('24 张在线风景已缓存');
  expect(state.images).toBe(24);
});

test('failed images are skipped while the expanded gallery retains catalog order', async ({
  page,
}) => {
  await mock(page);
  await page.route('https://thumb.wikimedia.org/**', (route) => {
    const failed = /30000000[1-3]\.jpg/.test(route.request().url());
    return failed ? route.abort() : route.fulfill({ body: jpeg, contentType: 'image/jpeg' });
  });
  await start(page);
  await enable(page);
  const images = page.locator('#quick-builtin-scenes [data-quick-scene]');
  await expect(images).toHaveCount(45);
  await expect(images.nth(21)).toHaveAttribute('data-quick-scene', 'commons:300000004');
  await expect(images.last()).toHaveAttribute('data-quick-scene', 'commons:300000027');
});

test('daily update follows category order, protects selected image and disabling stops future requests', async ({
  page,
}) => {
  const state = await mock(page);
  await start(page);
  await enable(page);
  await page.locator('[data-quick-scene="commons:300000001"]').click();
  state.base = 200000001;
  await page.clock.fastForward(24 * 3600 * 1000 + 1000);
  await open(page);
  await cacheExpect(page.locator('#online-gallery-status')).toContainText('25 张在线风景已缓存');
  await expect(page.locator('[data-quick-scene="commons:300000001"]')).toHaveCount(1);
  await expect(page.locator('#quick-builtin-scenes [data-quick-scene]').nth(21)).toHaveAttribute(
    'data-quick-scene',
    'commons:200000001'
  );
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /^blob:/);
  await page.locator('#online-gallery-toggle').click();
  const before = state.requests;
  await page.clock.fastForward(2 * 24 * 3600 * 1000);
  expect(state.requests).toBe(before);
  await expect(page.locator('#online-gallery-refresh')).toBeHidden();
});

test('failed update preserves cache and retries at bounded frequency', async ({ page }) => {
  const state = await mock(page);
  await start(page);
  await enable(page);
  state.fail = true;
  await page.clock.fastForward(60001);
  await page.locator('#online-gallery-refresh').click();
  await expect(page.locator('#online-gallery-status')).toContainText('暂时不可用');
  await expect(page.locator('#quick-builtin-scenes [data-quick-scene]')).toHaveCount(45);
  const before = state.requests;
  await page.clock.fastForward(30 * 60 * 1000);
  expect(state.requests).toBe(before);
  await page.clock.fastForward(31 * 60 * 1000);
  await expect.poll(() => state.requests).toBe(before + 1);
});

test('disabling an in-flight request leaves the offline gallery usable', async ({ page }) => {
  let requests = 0;
  await page.route(api, () => {
    requests++;
  });
  await start(page);
  await open(page);
  await page.locator('#online-gallery-toggle').click();
  await expect(page.locator('#online-gallery-status')).toContainText('正在检查');
  await page.locator('#online-gallery-toggle').click();
  await expect(page.locator('#online-gallery-status')).toContainText('21 张离线风景');
  await page.clock.fastForward(2 * 24 * 3600 * 1000);
  expect(requests).toBe(1);
  await page.getByRole('button', { name: '使用湖上晚霞', exact: true }).click();
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /201863386.jpg/);
});

test('cached online photos survive an actual browser process restart', async ({}, testInfo) => {
  const profile = testInfo.outputPath('online-profile');
  const launch = () =>
    chromium.launchPersistentContext(profile, {
      channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || undefined,
      baseURL: 'http://127.0.0.1:5175',
      timezoneId: 'Asia/Tokyo',
    });
  let context = await launch();
  try {
    await mock(context);
    let page = context.pages()[0];
    await start(page);
    await enable(page);
    await page.locator('[data-quick-scene="commons:300000001"]').click();
    await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /^blob:/);
    await context.close();
    context = await launch();
    await context.route('https://**', (route) => route.abort());
    page = context.pages()[0];
    await page.goto('/');
    await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('#scene-credit')).toContainText('Fixture Photographer');
  } finally {
    await context.close();
  }
});

test('failed cache commit cannot replace the previously saved gallery', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (window.rejectGallery && this.transaction.db.name === 'horizon-online-v1')
        throw new DOMException('full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  const state = await mock(page);
  await start(page);
  await enable(page);
  state.base = 200000001;
  await page.evaluate(() => (window.rejectGallery = true));
  await page.clock.fastForward(24 * 3600 * 1000 + 1000);
  await cacheExpect(page.locator('#online-gallery-status')).toContainText('暂时不可用');
  await expect(page.locator('[data-quick-scene="commons:300000001"]')).toHaveCount(1);
  await expect(page.locator('[data-quick-scene="commons:200000001"]')).toHaveCount(0);
  await page.reload();
  await open(page);
  await expect(page.locator('[data-quick-scene="commons:300000001"]')).toHaveCount(1);
});

test('a failed scenic replacement retains the displayed image attribution', async ({ page }) => {
  await start(page);
  await expect(page.locator('#scene-credit')).toContainText('Luca Bravo');
  await page.route('**/commons/54739240.jpg', (route) => route.abort());
  await open(page);
  await page.getByRole('button', { name: '使用阳朔峰林', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('保留当前显示');
  await expect(page.locator('#scene-credit')).toContainText('Luca Bravo');
  await openAttribution(page);
  await expect(page.locator('#photo-source-link')).toHaveAttribute('href', /unsplash.com/);
});

test('network recovery events during a failed active download do not leak rejected promises', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let finish;
  await page.route(
    api,
    (route) =>
      new Promise((resolve) => {
        finish = async () => {
          await route.abort();
          resolve();
        };
      })
  );
  await start(page);
  await open(page);
  await page.locator('#online-gallery-toggle').click();
  await expect.poll(() => !!finish).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await finish();
  await expect(page.locator('#online-gallery-status')).toContainText('暂时不可用');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  expect(errors).toEqual([]);
});
