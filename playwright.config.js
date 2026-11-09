import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5175',
    viewport: { width: 1280, height: 800 },
    timezoneId: 'Asia/Tokyo',
    reducedMotion: 'reduce',
    channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve.mjs --port 5175',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: !process.env.CI,
  },
  reporter: 'list',
});
