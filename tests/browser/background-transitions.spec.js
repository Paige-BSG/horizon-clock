import { test, expect } from '@playwright/test';
import { normalizeSettings, SETTINGS_KEY } from '../../lib/settings.js';

test.use({ reducedMotion: 'no-preference' });

async function start(page) {
  await page.addInitScript(
    ({ key, settings }) => localStorage.setItem(key, JSON.stringify(settings)),
    {
      key: SETTINGS_KEY,
      settings: normalizeSettings({
        weatherEnabled: false,
        autoNight: false,
        city: '东京',
        rotate: false,
      }),
    }
  );
  await page.goto('/');
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /lake.jpg/);
  await page.waitForFunction(
    () => Number(getComputedStyle(document.getElementById('landscape-backdrop')).opacity) > 0.999
  );
}

test('scene transitions keep an opaque image under the entire fade', async ({ page }) => {
  await start(page);
  await page.keyboard.press('b');
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /mountain.jpg/);
  await page.waitForFunction(() => {
    const opacity = Number(
      getComputedStyle(document.querySelector('.landscape-layer.visible')).opacity
    );
    return opacity > 0.1 && opacity < 0.9;
  });
  const coverage = await page.evaluate(() => {
    const layers = [...document.querySelectorAll('.landscape-layer')];
    for (const layer of layers) {
      for (const animation of layer.getAnimations()) {
        animation.pause();
        animation.currentTime = 900;
      }
    }
    return (
      1 -
      layers.reduce(
        (remaining, layer) => remaining * (1 - Number(getComputedStyle(layer).opacity)),
        1
      )
    );
  });
  expect(coverage).toBeGreaterThan(0.999);
});

test('rapid scene requests preserve full coverage and finish on the latest selection', async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    window.fadeSamples = [];
    window.sampleFade = true;
    const sample = () => {
      if (!window.sampleFade) return;
      const layers = [...document.querySelectorAll('.landscape-layer')];
      window.fadeSamples.push(
        1 -
          layers.reduce(
            (remaining, layer) => remaining * (1 - Number(getComputedStyle(layer).opacity)),
            1
          )
      );
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press('b');
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /mountain.jpg/);
  await page.keyboard.press('b');
  await expect(page.locator('.landscape-layer.visible')).toHaveAttribute('src', /coast.jpg/);
  await page.waitForFunction(
    () =>
      Number(getComputedStyle(document.querySelector('.landscape-layer.visible')).opacity) > 0.999
  );
  const samples = await page.evaluate(() => {
    window.sampleFade = false;
    return window.fadeSamples;
  });
  expect(samples.length).toBeGreaterThan(10);
  expect(Math.min(...samples)).toBeGreaterThan(0.999);
});
