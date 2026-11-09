import { test, expect } from '@playwright/test';
import { normalizeSettings, SETTINGS_KEY } from '../../lib/settings.js';
import { NOW } from '../fixtures.js';

const picker = (page) => page.getByRole('dialog', { name: '换个风景', exact: true });
async function start(page, settings = {}) {
  await page.clock.install({ time: new Date(NOW) });
  await page.addInitScript(
    ({ key, settings }) => localStorage.setItem(key, JSON.stringify(settings)),
    {
      key: SETTINGS_KEY,
      settings: normalizeSettings({ onboarded: true, ...settings }),
    }
  );
  await page.goto('/');
}
async function open(page) {
  await page.getByRole('button', { name: '选择背景', exact: true }).click();
  await expect(picker(page)).toBeVisible();
}
async function preferences(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SETTINGS_KEY);
}
async function importPhotos(page, files) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入照片', exact: true }).click();
  await (await chooser).setFiles(files);
}

test('choose a builtin in two clicks, save and return to the clock', async ({ page }) => {
  await start(page, { nightScene: 'coast' });
  await open(page);
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await expect(page.locator('#picker-context')).toContainText('白天');
  await page.getByRole('button', { name: '使用群山之间', exact: true }).click();
  await expect(picker(page)).not.toBeVisible();
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /mountain.jpg/);
  expect(await preferences(page)).toMatchObject({ scene: 'mountain', nightScene: 'coast' });
  await page.clock.runFor(8100);
  await expect(page.locator('body')).toHaveClass(/immersive/);
});

test('quick access uses the current period even after editing a different one', async ({
  page,
}) => {
  await start(page, { autoNight: true });
  await page.keyboard.press('s');
  await page.getByRole('tab', { name: '背景', exact: true }).click();
  await page.getByRole('button', { name: '夜间', exact: true }).click();
  await page.getByRole('button', { name: '完成设置' }).click();
  await open(page);
  await expect(page.locator('#picker-context')).toContainText('白天');
  await page.keyboard.press('Escape');
  await page.clock.setSystemTime(new Date('2026-11-09T23:00:00+09:00'));
  await open(page);
  await expect(page.locator('#picker-context')).toContainText('夜间');
  await page.getByRole('button', { name: '使用蓝色潮汐', exact: true }).click();
  expect(await preferences(page)).toMatchObject({ scene: 'lake', nightScene: 'coast' });
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /coast.jpg/);
  await page.clock.setSystemTime(new Date('2026-11-10T08:00:00+09:00'));
  await page.clock.runFor(1100);
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /lake.jpg/);
});

test('import from solid color without source selection and use the photo immediately', async ({
  page,
}) => {
  await start(page, { background: 'solid', nightBackground: 'solid' });
  await open(page);
  await importPhotos(page, ['assets/landscapes/lake.jpg']);
  await expect(picker(page)).not.toBeVisible();
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /^blob:/);
  expect(await preferences(page)).toMatchObject({
    background: 'landscape',
    collection: 'personal',
    nightBackground: 'solid',
  });
  await open(page);
  await expect(
    page.getByRole('button', { name: '使用照片 lake.jpg', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '使用蓝色潮汐', exact: true }).click();
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /coast.jpg/);
  expect(await preferences(page)).toMatchObject({ collection: 'builtin', scene: 'coast' });
});

test('canceled and invalid imports keep the picker and previous background', async ({ page }) => {
  await start(page);
  await open(page);
  await importPhotos(page, []);
  await expect(picker(page)).toBeVisible();
  await importPhotos(page, {
    name: 'bad.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.locator('#toast')).toContainText('未导入');
  await expect(picker(page)).toBeVisible();
  expect(await preferences(page)).toMatchObject({ collection: 'builtin', scene: 'lake' });
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /lake.jpg/);
});

test('brightness and pinning persist, and detailed controls remain reachable', async ({ page }) => {
  await start(page);
  await open(page);
  await page.getByLabel('背景亮度', { exact: true }).fill('40');
  await page.getByRole('button', { name: '固定这张', exact: true }).click();
  await expect(page.locator('#quick-rotation-status')).toContainText('已固定当前风景');
  await page.getByRole('button', { name: '构图与更多设置' }).click();
  await expect(picker(page)).not.toBeVisible();
  await expect(page.getByRole('tab', { name: '背景', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.locator('#background-dim')).toHaveValue('60');
  await expect(page.locator('#rotate-background')).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveAttribute('data-preview-period');
  await page.clock.runFor(65000);
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /lake.jpg/);
  expect(await preferences(page)).toMatchObject({ rotate: false, dim: 60 });
});

test('slow import keeps its original period after closing and opening detailed night settings', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    window.importWait = new Promise((resolve) => {
      window.finishImport = resolve;
    });
    HTMLImageElement.prototype.decode = async function () {
      if (this.src.startsWith('blob:')) await window.importWait;
      return decode.call(this);
    };
  });
  await start(page);
  await open(page);
  await importPhotos(page, ['assets/landscapes/lake.jpg']);
  await expect(page.locator('#quick-photo-import')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await page.getByRole('tab', { name: '背景', exact: true }).click();
  await page.getByRole('button', { name: '夜间', exact: true }).click();
  await page.evaluate(() => window.finishImport());
  await expect(page.locator('#photo-import')).toBeEnabled();
  expect(await preferences(page)).toMatchObject({
    collection: 'personal',
    nightCollection: 'builtin',
    nightScene: 'lake',
  });
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /^blob:/);
});

test('quick picker stays within small and fractional-scale logical viewports', async ({ page }) => {
  await start(page);
  await open(page);
  await importPhotos(page, [
    'assets/landscapes/lake.jpg',
    'assets/landscapes/mountain.jpg',
    'assets/landscapes/coast.jpg',
  ]);
  await expect(picker(page)).not.toBeVisible();
  for (const size of [
    { width: 360, height: 640 },
    { width: 540, height: 540 },
    { width: 1408, height: 792 },
  ]) {
    await page.setViewportSize(size);
    await open(page);
    const box = await picker(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    await expect(page.locator('#quick-background-brightness')).toBeInViewport();
    await expect(page.locator('#picker-advanced')).toBeInViewport();
    await page.keyboard.press('Escape');
  }
});

test('finishing a slow import cannot overwrite a newer explicit selection or close a reopened picker', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    window.importWait = new Promise((resolve) => {
      window.finishImport = resolve;
    });
    HTMLImageElement.prototype.decode = async function () {
      if (this.src.startsWith('blob:')) await window.importWait;
      return decode.call(this);
    };
  });
  await start(page);
  await open(page);
  await importPhotos(page, ['assets/landscapes/lake.jpg']);
  await expect(page.locator('#quick-photo-import')).toBeDisabled();
  await page.getByRole('button', { name: '使用群山之间', exact: true }).click();
  await open(page);
  await page.evaluate(() => window.finishImport());
  await expect(page.locator('#quick-photo-import')).toBeEnabled();
  await expect(page.getByRole('button', { name: '使用照片 lake.jpg', exact: true })).toBeVisible();
  await expect(picker(page)).toBeVisible();
  expect(await preferences(page)).toMatchObject({ collection: 'builtin', scene: 'mountain' });
});

test('keyboard focus keeps the toolbar available after closing the picker', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '选择背景', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.clock.runFor(8100);
  await expect(page.getByRole('button', { name: '选择背景', exact: true })).toBeFocused();
  await expect(page.locator('body')).not.toHaveClass(/immersive/);
});
