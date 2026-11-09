import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { normalizeSettings, SETTINGS_KEY } from '../lib/settings.js';

const server = spawn(process.execPath, ['scripts/serve.mjs', '--port', '5198'], {
  stdio: 'ignore',
});
let browser;
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch('http://127.0.0.1:5198')).ok) break;
    } catch {
      /* Starting loopback server. */
    }
    if (i === 49) throw new Error('Preview server did not start');
    await delay(100);
  }
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || undefined,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SETTINGS_KEY,
    value: normalizeSettings({ weatherEnabled: false, autoNight: false, city: '东京' }),
  });
  await page.goto('http://127.0.0.1:5198');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.landscape-backdrop.ready');
  await mkdir('docs/images', { recursive: true });
  await mkdir('previews', { recursive: true });
  await page.screenshot({ path: 'previews/quick-clock.png' });
  await page.screenshot({ path: 'docs/images/clock.png' });
  await page.locator('#settings-open').click();
  await page.screenshot({ path: 'previews/concise-settings.png' });
  await page.getByRole('tab', { name: '背景', exact: true }).click();
  await page.screenshot({ path: 'docs/images/background-settings.png' });
  await page.keyboard.press('Escape');
  await page.locator('#settings-open').click();
  await page.getByRole('tab', { name: '背景', exact: true }).click();
  await page.getByRole('button', { name: '选择背景', exact: true }).click();
  await page
    .locator('#quick-builtin-scenes img')
    .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  await page.screenshot({ path: 'docs/images/quick-background.png' });
  await page
    .locator('#photo-files')
    .setInputFiles([
      'assets/landscapes/lake.jpg',
      'assets/landscapes/mountain.jpg',
      'assets/landscapes/coast.jpg',
    ]);
  await page.waitForFunction(() => !document.getElementById('background-picker').open);
  await page.locator('#settings-open').click();
  await page.getByRole('tab', { name: '背景', exact: true }).click();
  await page.getByRole('button', { name: '选择背景', exact: true }).click();
  await page
    .locator('#quick-photo-list img')
    .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  await page.screenshot({ path: 'docs/images/quick-personal.png' });
  await page.getByRole('button', { name: '使用湖畔晨雾', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#settings-open').click();
  await page.getByRole('tab', { name: '背景', exact: true }).click();
  await page.getByRole('button', { name: '选择背景', exact: true }).click();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  await page.screenshot({ path: 'docs/images/quick-mobile.png' });
  console.log('Captured quick backgrounds in offline mode using bundled, licensed photo fixtures.');
} finally {
  await browser?.close();
  server.kill();
}
