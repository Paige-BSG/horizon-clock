import { test, expect } from '@playwright/test';
import { normalizeSettings, SETTINGS_KEY } from '../../lib/settings.js';

async function start(
  page,
  { time = '2026-01-03T06:59:00+09:00', alarms = [], desktop = false } = {}
) {
  await page.clock.install({ time: new Date(time) });
  await page.addInitScript(
    ({ key, settings, desktop }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(settings));
      if (!desktop) return;
      window.alarmCalls = [];
      const view = { active: [], snoozed: [], error: null };
      let scheduled = [];
      const fired = new Set();
      window.__TAURI__ = {
        core: {
          invoke: async (command, args) => {
            if (command !== 'alarm') return false;
            const a = args.action;
            window.alarmCalls.push(a);
            if (window.alarmUnavailable) throw Error('unavailable');
            if (a.type === 'sync') {
              scheduled = a.occurrences;
              view.active = view.active.filter((item) => a.enabled_ids.includes(item.alarmId));
              view.snoozed = view.snoozed.filter((item) => a.enabled_ids.includes(item.alarmId));
            }
            if (a.type === 'status') {
              for (const item of [...scheduled, ...view.snoozed]) {
                const key = `${item.alarmId}@${item.at}`;
                if (item.at <= Date.now() && Date.now() - item.at < 60000 && !fired.has(key)) {
                  fired.add(key);
                  view.active.push(item);
                }
              }
              view.snoozed = view.snoozed.filter((item) => item.at > Date.now());
            }
            if (a.type === 'snooze') {
              view.snoozed.push(
                ...view.active.map((item) => ({ ...item, at: Date.now() + 300000 }))
              );
              view.active = [];
            }
            if (a.type === 'stop') view.active = [];
            if (a.type === 'preview') view.error = window.alarmSoundError || null;
            return structuredClone(view);
          },
        },
      };
    },
    {
      key: SETTINGS_KEY,
      settings: normalizeSettings({
        weatherEnabled: false,
        autoNight: false,
        rotate: false,
        fullscreenOnStart: false,
        alarms,
      }),
      desktop,
    }
  );
  await page.goto('/');
}
async function settings(page) {
  await page.locator('#settings-open').click();
  await page.getByRole('tab', { name: '闹钟', exact: true }).click();
}
const morning = { id: 'morning', time: '07:00', label: '起床', enabled: true, repeat: 'workday' };

test('create, restore, edit, disable and delete an alarm with the mainland calendar', async ({
  page,
}) => {
  await start(page);
  await settings(page);
  await page.locator('#alarm-add').click();
  await page.locator('#alarm-label').fill('起床');
  await page.locator('#alarm-save').click();
  await expect(page.locator('#alarm-list')).toContainText('工作日（含调休）');
  await expect(page.locator('#alarm-list')).toContainText('下次 1月4日 07:00');
  await page.reload();
  await expect(page.locator('#alarm-next')).toContainText('1月4日 07:00');
  await settings(page);
  await page.locator('.alarm-edit').click();
  await page.locator('#alarm-repeat').selectOption('holiday');
  await page.locator('#alarm-save').click();
  await expect(page.locator('#alarm-list')).toContainText('下次 1月3日 07:00');
  await page.locator('#alarm-list .switch').uncheck();
  await expect(page.locator('#alarm-list')).toContainText('已关闭');
  await page.locator('.alarm-edit').click();
  await page.locator('#alarm-delete').click();
  await expect(page.locator('#alarm-empty')).toBeVisible();
  await page.locator('#settings-close').click();
  await expect(page.locator('#alarm-next')).toBeHidden();
});

test('native ringing overlays settings; snooze and stop are explicit and do not repeat', async ({
  page,
}) => {
  await start(page, { desktop: true, alarms: [morning], time: '2026-01-04T06:59:58+09:00' });
  await settings(page);
  await page.clock.runFor(3100);
  await expect(page.locator('#alarm-alert')).toBeVisible();
  await expect(page.locator('#alarm-alert-title')).toHaveText('起床');
  await page.keyboard.press('Escape');
  await expect(page.locator('#alarm-alert')).toBeVisible();
  await page.locator('#alarm-snooze').click();
  await expect(page.locator('#alarm-alert')).not.toBeVisible();
  await expect(page.locator('#alarm-next')).toContainText('稍后提醒');
  await page.clock.runFor(301000);
  await expect(page.locator('#alarm-alert')).toBeVisible();
  await page.locator('#alarm-stop').click();
  await page.clock.runFor(2000);
  await expect(page.locator('#alarm-alert')).not.toBeVisible();
  expect(await page.evaluate(() => window.alarmCalls.some((call) => call.type === 'stop'))).toBe(
    true
  );
});

test('unknown years pause calendar-based alarms while daily alarms still schedule', async ({
  page,
}) => {
  await start(page, { alarms: [morning], time: '2028-01-01T06:59:00+09:00' });
  await settings(page);
  await expect(page.locator('#alarm-calendar-warning')).toContainText('2028年日历尚未内置');
  await expect(page.locator('#alarm-list')).toContainText('日历未覆盖');
  await page.locator('.alarm-edit').click();
  await page.locator('#alarm-repeat').selectOption('daily');
  await page.locator('#alarm-save').click();
  await expect(page.locator('#alarm-list')).toContainText('下次 1月1日 07:00');
});

test('custom days and one-time dates validate without silently creating an alarm', async ({
  page,
}) => {
  await start(page);
  await settings(page);
  await page.locator('#alarm-add').click();
  await page.locator('#alarm-repeat').selectOption('weekly');
  for (const input of await page.locator('[name="alarm-weekday"]').all()) await input.uncheck();
  await page.locator('#alarm-save').click();
  await expect(page.locator('#alarm-editor')).toBeVisible();
  await expect(page.locator('#alarm-list .alarm-row')).toHaveCount(0);
  await page.locator('#alarm-repeat').selectOption('once');
  await page.locator('#alarm-date').fill('2026-01-02');
  await page.locator('#alarm-save').click();
  await expect(page.locator('#toast')).toContainText('请选择未来');
  await page.locator('#alarm-date').fill('2026-01-05');
  await page.locator('#alarm-save').click();
  await expect(page.locator('#alarm-list')).toContainText('2026-01-05 · 仅一次');
});

test('sound failures and unavailable native service are visible', async ({ page }) => {
  await start(page, { desktop: true, alarms: [morning] });
  await settings(page);
  await page.evaluate(() => {
    window.alarmSoundError = '无法启动铃声，请检查 mpv 是否已安装。';
  });
  await page.locator('#alarm-preview').click();
  await expect(page.locator('#toast')).toContainText('mpv');
  await page.evaluate(() => {
    window.alarmUnavailable = true;
  });
  await page.clock.runFor(1100);
  await expect(page.locator('#alarm-runtime-status')).toContainText('闹钟未就绪');
});

test('alarm list and editor fit a narrow touch screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, { alarms: [morning] });
  await expect(page.locator('#alarm-next')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settings(page);
  await page.locator('.alarm-edit').click();
  await page.locator('#alarm-repeat').selectOption('weekly');
  await page.locator('#alarm-save').scrollIntoViewIfNeeded();
  for (const id of ['alarm-time', 'alarm-label', 'alarm-weekdays', 'alarm-save']) {
    const bounds = await page.locator(`#${id}`).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: '/tmp/horizon-alarm-mobile.png' });
});

test('storage failure does not claim an alarm was saved or change the native schedule', async ({
  page,
}) => {
  await start(page, { desktop: true });
  await settings(page);
  await page.locator('#alarm-add').click();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('full');
    };
  });
  await page.locator('#alarm-save').click();
  await expect(page.locator('#toast')).toContainText('设置未能保存');
  await expect(page.locator('#alarm-list .alarm-row')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.alarmCalls
        .filter((call) => call.type === 'sync')
        .every((call) => call.occurrences.length === 0)
    )
  ).toBe(true);
});
