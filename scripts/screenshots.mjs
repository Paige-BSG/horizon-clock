import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { normalizeSettings, SETTINGS_KEY } from '../lib/settings.js';

const server = spawn(process.execPath, ['scripts/serve.mjs', '--port', '5199'], {
  stdio: 'ignore',
});
let browser;
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch('http://127.0.0.1:5199')).ok) break;
    } catch {
      /* Wait for the loopback server. */
    }
    if (attempt === 49) throw new Error('Screenshot server did not start');
    await delay(100);
  }
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || undefined,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    timezoneId: 'Asia/Tokyo',
  });
  const preferences = normalizeSettings({ onboarded: true, weatherEnabled: true });
  await page.addInitScript(
    ({ key, settings }) => localStorage.setItem(key, JSON.stringify(settings)),
    { key: SETTINGS_KEY, settings: preferences }
  );
  await page.goto('http://127.0.0.1:5199');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.landscape-backdrop.ready');
  await page.waitForFunction(
    () => !['未启用', '更新中'].includes(document.getElementById('weather-status').textContent)
  );
  await mkdir('docs/images', { recursive: true });
  await page.screenshot({ path: 'docs/images/clock.png' });
  await page.keyboard.press('s');
  await page.getByRole('tab', { name: '背景', exact: true }).click();
  await page.screenshot({ path: 'docs/images/background-settings.png' });
  await page
    .locator('#photo-files')
    .setInputFiles(['assets/landscapes/lake.jpg', 'assets/landscapes/mountain.jpg']);
  await page.waitForSelector('.photo-card');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('#background-panel').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: 'docs/images/personal-album.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '夜间', exact: true }).click();
  await page.getByRole('button', { name: '纯色', exact: true }).click();
  await page.screenshot({ path: 'docs/images/night-settings.png' });
  await page.getByRole('button', { name: '白天', exact: true }).click();
  await page.getByRole('button', { name: '精选风景', exact: true }).click();
  await page.getByRole('button', { name: '完成设置' }).click();
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.screenshot({ path: 'docs/images/portrait.png' });
  console.log(
    'Captured current UI with a real optional weather request; no weather fixtures used.'
  );
} finally {
  await browser?.close();
  server.kill();
}
