import { test, expect, chromium } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import { normalizeSettings, SETTINGS_KEY } from '../../lib/settings.js';
import { NOW } from '../fixtures.js';

async function start(page, settings = {}) {
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
        ...settings,
      }),
    }
  );
  await page.goto('/');
}
async function backgroundSettings(page) {
  await page.keyboard.press('s');
  await page.getByRole('tab', { name: '背景', exact: true }).click();
}
async function importFiles(page, files) {
  await page.locator('#photo-files').setInputFiles(files);
  await expect(page.locator('#photo-import')).toBeEnabled();
}
const photo = 'assets/landscapes/lake.jpg';

test('photos survive reload, deduplicate, crop, and leave original files intact', async ({
  page,
}) => {
  const outbound = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5175') && !request.url().startsWith('blob:'))
      outbound.push(request.url());
  });
  await start(page);
  await backgroundSettings(page);
  await page.getByRole('button', { name: '个人相册', exact: true }).click();
  await importFiles(page, [photo]);
  await expect(page.locator('.photo-card')).toHaveCount(1);
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /^blob:/);
  await importFiles(page, [photo]);
  await expect(page.locator('.photo-card')).toHaveCount(1);
  await expect(page.locator('#toast')).toHaveText(/重复/);
  await page.locator('#photo-x').fill('20');
  await page.locator('#photo-y').fill('75');
  await expect(page.locator('.landscape-layer.visible')).toHaveCSS('object-position', '20% 75%');
  await page.reload();
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /^blob:/);
  await backgroundSettings(page);
  await expect(page.locator('#photo-x')).toHaveValue('20');
  await expect(page.locator('#photo-y')).toHaveValue('75');
  await page.getByRole('button', { name: '移出照片 lake.jpg', exact: true }).click();
  await expect(page.locator('.photo-card')).toHaveCount(0);
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /lake.jpg/);
  expect((await stat(photo)).size).toBeGreaterThan(0);
  expect(outbound).toEqual([]);
});

test('album and framing survive an actual browser process restart', async ({}, testInfo) => {
  const path = testInfo.outputPath('persistent-photo-profile');
  const launch = () =>
    chromium.launchPersistentContext(path, {
      channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || undefined,
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce',
    });
  let context = await launch();
  try {
    let page = context.pages()[0];
    await start(page);
    await backgroundSettings(page);
    await importFiles(page, [photo]);
    await expect(page.locator('.photo-card')).toHaveCount(1);
    await page.locator('#photo-x').fill('30');
    await page.getByRole('checkbox', { name: 'lake.jpg 参与轮换' }).uncheck();
    await page.getByRole('button', { name: '完成设置' }).click();
    await expect(page.locator('.landscape-layer.visible')).toHaveCSS('object-position', '30% 50%');
    await context.close();
    context = await launch();
    page = context.pages()[0];
    await page.goto('http://127.0.0.1:5175');
    await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('.landscape-layer.visible')).toHaveCSS('object-position', '30% 50%');
    await backgroundSettings(page);
    await expect(page.locator('.photo-card')).toHaveCount(1);
    await expect(page.getByRole('checkbox', { name: 'lake.jpg 参与轮换' })).not.toBeChecked();
  } finally {
    await context.close();
  }
});

test('personal rotation honors participation checkboxes and can freeze one photo', async ({
  page,
}) => {
  await start(page, { interval: 30 });
  await backgroundSettings(page);
  await importFiles(page, [photo, 'assets/landscapes/mountain.jpg']);
  await expect(page.locator('.photo-card')).toHaveCount(2);
  await page.getByRole('button', { name: '完成设置' }).click();
  const initial = await page.locator('.landscape-layer.visible').getAttribute('src');
  await page.clock.runFor(30100);
  await expect(page.locator('.landscape-layer.visible')).not.toHaveAttribute('src', initial);
  await backgroundSettings(page);
  await page.getByRole('checkbox', { name: 'mountain.jpg 参与轮换' }).uncheck();
  await page.getByRole('button', { name: '显示照片 lake.jpg', exact: true }).click();
  await page.getByRole('button', { name: '完成设置' }).click();
  const fixed = await page.locator('.landscape-layer.visible').getAttribute('src');
  await page.clock.runFor(60100);
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', fixed);
});

test('night preview is temporary and switches to independent background on schedule', async ({
  page,
}) => {
  await start(page, { autoNight: true });
  await backgroundSettings(page);
  await page.getByRole('button', { name: '夜间', exact: true }).click();
  await page.locator('#display-brightness').fill('20');
  await page.getByRole('button', { name: '纯色', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-background', 'solid');
  expect(
    await page.locator('body').evaluate((e) => e.style.getPropertyValue('--display-brightness'))
  ).toBe('0.2');
  await page.getByRole('button', { name: '完成设置' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-background', 'landscape');
  expect(
    await page.locator('body').evaluate((e) => e.style.getPropertyValue('--display-brightness'))
  ).toBe('1');
  await page.clock.setSystemTime(new Date('2026-11-09T23:00:00+09:00'));
  await page.clock.runFor(1100);
  await expect(page.locator('body')).toHaveAttribute('data-background', 'solid');
  expect(
    await page.locator('body').evaluate((e) => e.style.getPropertyValue('--display-brightness'))
  ).toBe('0.2');
  await page.clock.setSystemTime(new Date('2026-11-10T08:00:00+09:00'));
  await page.clock.runFor(1100);
  await expect(page.locator('body')).toHaveAttribute('data-background', 'landscape');
});

test('invalid or spoofed photo files fail honestly without affecting the clock', async ({
  page,
}) => {
  await start(page);
  await backgroundSettings(page);
  await page.getByRole('button', { name: '个人相册', exact: true }).click();
  await importFiles(page, {
    name: 'fake.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  });
  await expect(page.locator('.photo-card')).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveText(/未导入/);
  await expect(page.locator('#hours')).toHaveText('12');
});

test('import re-encodes photos without retaining source EXIF metadata', async ({ page }) => {
  const raw = await readFile(photo),
    payload = Buffer.from('Exif\x00\x00private-camera-serial');
  const segment = Buffer.alloc(4);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(payload.length + 2, 2);
  const input = Buffer.concat([raw.subarray(0, 2), segment, payload, raw.subarray(2)]);
  await start(page);
  await backgroundSettings(page);
  await importFiles(page, { name: 'exif.jpg', mimeType: 'image/jpeg', buffer: input });
  await expect(page.locator('.photo-card')).toHaveCount(1);
  const retained = await page.evaluate(async () => {
    const request = indexedDB.open('horizon-photos-v1');
    const db = await new Promise((resolve) => (request.onsuccess = () => resolve(request.result)));
    const query = db.transaction('photos').objectStore('photos').getAll();
    const photos = await new Promise((resolve) => (query.onsuccess = () => resolve(query.result)));
    return new TextDecoder('latin1')
      .decode(await photos[0].image.arrayBuffer())
      .includes('private-camera-serial');
  });
  expect(retained).toBe(false);
});

test('unavailable album storage preserves builtin backgrounds', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw Error('Storage disabled');
    };
  });
  await start(page);
  await backgroundSettings(page);
  await page.getByRole('button', { name: '个人相册', exact: true }).click();
  await expect(page.locator('#photo-status')).toHaveText(/无法保存相册/);
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /lake.jpg/);
});

test('rapid selection cannot let a slow earlier image replace the final choice', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    window.mountainWait = new Promise((resolve) => (window.releaseMountain = resolve));
    HTMLImageElement.prototype.decode = async function () {
      if (this.src.includes('mountain.jpg')) await window.mountainWait;
      return decode.call(this);
    };
  });
  await start(page);
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /lake.jpg/);
  await backgroundSettings(page);
  await page.getByRole('button', { name: '群山之间', exact: true }).click();
  await page.getByRole('button', { name: '湖畔晨雾', exact: true }).click();
  await page.evaluate(() => window.releaseMountain());
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /lake.jpg/);
  await page.clock.runFor(1000);
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /lake.jpg/);
});

test('a full album rejects another image without losing existing photos', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const bytes = await (await fetch('/assets/icon.png')).blob();
    const image = await createImageBitmap(bytes),
      canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    canvas.getContext('2d').drawImage(image, 0, 0, 32, 32);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg'));
    image.close();
    const request = indexedDB.open('horizon-photos-v1');
    const db = await new Promise((resolve) => (request.onsuccess = () => resolve(request.result)));
    const tx = db.transaction('photos', 'readwrite'),
      store = tx.objectStore('photos');
    for (let i = 0; i < 24; i++)
      store.put({
        id: 'photo:' + i.toString(16).padStart(64, '0'),
        name: `sample-${i}.jpg`,
        image: blob,
        thumbnail: blob,
        enabled: true,
        x: 50,
        y: 50,
        createdAt: i,
      });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = reject;
    });
    db.close();
  });
  await page.reload();
  await backgroundSettings(page);
  await page.getByRole('button', { name: '个人相册', exact: true }).click();
  await expect(page.locator('.photo-card')).toHaveCount(24);
  await importFiles(page, [photo]);
  await expect(page.locator('#toast')).toHaveText(/未导入/);
  await expect(page.locator('.photo-card')).toHaveCount(24);
});
