import { isDesktop, native } from './desktop.js';
import {
  ALARM_LIMIT,
  REPEATS,
  alarmSchedule,
  nextOccurrence,
  normalizeAlarms,
} from './alarm-model.js';
import { CHINA_CALENDARS, calendarDay, localDate, pad } from './china-calendar.js';

const $ = (id) => document.getElementById(id);
const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
const stamp = (date) =>
  `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;

export function initializeAlarms({ getSettings, save, toast, resetIdle, openSettings }) {
  let editId = null;
  let signature = '';
  let lastPlan = 0;
  let busy = false;
  let syncNeeded = true;
  let view = { active: [], snoozed: [], error: null };
  let connectionError = '';
  let context = '';
  let request = 0;
  let listMinute = -1;
  let previewUntil = 0;
  const alarms = () => getSettings().alarms;
  let savedAlarms = normalizeAlarms(alarms());

  function description(alarm) {
    if (alarm.repeat === 'weekly')
      return `每周${alarm.weekdays.map((day) => weekdayNames[day]).join('、')}`;
    if (alarm.repeat === 'once') return `${alarm.date} · 仅一次`;
    return REPEATS[alarm.repeat];
  }
  function renderList() {
    listMinute = Math.floor(Date.now() / 60000);
    $('alarm-list').replaceChildren();
    $('alarm-empty').hidden = alarms().length > 0;
    $('alarm-add').disabled = alarms().length >= ALARM_LIMIT;
    for (const alarm of alarms()) {
      const row = document.createElement('div');
      row.className = 'alarm-row';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'alarm-edit';
      edit.setAttribute('aria-label', `编辑闹钟 ${alarm.time} ${alarm.label}`);
      const time = document.createElement('strong');
      time.textContent = alarm.time;
      const detail = document.createElement('span');
      detail.textContent = `${alarm.label || '闹钟'} · ${description(alarm)}`;
      const state = document.createElement('small');
      const next = nextOccurrence(alarm);
      state.textContent = !alarm.enabled
        ? '已关闭'
        : next
          ? `下次 ${stamp(next)}`
          : alarm.repeat === 'once'
            ? '已结束'
            : '日历未覆盖，等待更新';
      edit.append(time, detail, state);
      edit.addEventListener('click', () => openEditor(alarm));
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'switch';
      toggle.checked = alarm.enabled;
      toggle.setAttribute('aria-label', `启用闹钟 ${alarm.time} ${alarm.label}`);
      toggle.addEventListener('change', () => {
        alarm.enabled = toggle.checked;
        changed();
      });
      row.append(edit, toggle);
      $('alarm-list').append(row);
    }
  }

  function renderSummary() {
    const now = new Date();
    if (
      listMinute !== Math.floor(now.getTime() / 60000) &&
      !$('alarm-list').contains(document.activeElement)
    )
      renderList();
    const next = alarms()
      .map((alarm) => nextOccurrence(alarm, now))
      .filter(Boolean)
      .sort((a, b) => a - b)[0];
    const snooze = view.snoozed
      ?.filter((item) => item.at > now.getTime())
      .sort((a, b) => a.at - b.at)[0];
    const upcoming = snooze && (!next || snooze.at < next.getTime()) ? new Date(snooze.at) : next;
    const active = alarms().some((alarm) => alarm.enabled);
    $('alarm-next').hidden = !active && !upcoming;
    $('alarm-next').textContent = connectionError
      ? '闹钟未就绪'
      : upcoming
        ? `${snooze && upcoming.getTime() === snooze.at ? '稍后提醒' : '闹钟'} · ${stamp(upcoming)}`
        : '闹钟 · 日历待更新';
    if (
      !upcoming &&
      alarms()
        .filter((alarm) => alarm.enabled)
        .every((alarm) => alarm.repeat === 'once')
    ) {
      $('alarm-next').hidden = true;
    }
    const year = now.getFullYear();
    const day = calendarDay(now);
    $('alarm-calendar').textContent =
      `${year}年 · ${day === 'workday' ? '今天是工作日' : day === 'holiday' ? '今天是假日' : '日历未覆盖'}`;
    const edge = new Date(now);
    edge.setDate(edge.getDate() + 35);
    const missing = !CHINA_CALENDARS[year]
      ? year
      : !CHINA_CALENDARS[edge.getFullYear()]
        ? edge.getFullYear()
        : null;
    $('alarm-calendar-warning').hidden = missing === null;
    $('alarm-calendar-warning').textContent =
      `${missing}年日历尚未内置。该年的工作日和假日闹钟暂停，请更新应用；每天、仅一次和自选星期仍可用。`;
    $('alarm-runtime-status').textContent =
      connectionError ||
      (isDesktop
        ? '使用设备本地时间。请保持应用运行、设备不休眠，且系统音量可听见。'
        : '浏览器仅预览设置，不会响铃。请使用桌面版。');
    $('alarm-runtime-status').classList.toggle('alarm-warning', !!connectionError);
    $('alarm-preview').disabled = !isDesktop;
    $('alarm-alert-error').textContent = view.error || '';
    $('alarm-alert-error').hidden = !view.error;
    $('alarm-sound-status').textContent = view.error || '';
    $('alarm-sound-status').hidden = !view.error;
    if (view.active?.length) {
      $('alarm-alert-title').textContent = view.active.map((item) => item.label).join('、');
      $('alarm-alert-time').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      if (!$('alarm-alert').open) {
        resetIdle();
        $('alarm-alert').showModal();
        $('alarm-stop').focus();
      }
    } else if ($('alarm-alert').open) $('alarm-alert').close();
  }

  function render() {
    savedAlarms = normalizeAlarms(alarms());
    renderList();
    renderSummary();
    const nextSignature = JSON.stringify(alarms());
    if (signature !== nextSignature) {
      signature = nextSignature;
      syncNeeded = true;
      poll();
    }
  }
  function changed() {
    const saved = save() !== false;
    if (!saved) getSettings().alarms = savedAlarms;
    render();
    return saved;
  }
  function editorFields() {
    $('alarm-date-field').hidden = $('alarm-repeat').value !== 'once';
    $('alarm-weekdays').hidden = $('alarm-repeat').value !== 'weekly';
  }
  function openEditor(alarm = null) {
    editId = alarm?.id || null;
    $('alarm-editor-title').textContent = alarm ? '编辑闹钟' : '添加闹钟';
    $('alarm-time').value = alarm?.time || '07:00';
    $('alarm-label').value = alarm?.label || '';
    $('alarm-repeat').value = alarm?.repeat || 'workday';
    const tomorrow = new Date();
    if (`${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}` >= $('alarm-time').value)
      tomorrow.setDate(tomorrow.getDate() + 1);
    $('alarm-date').value = alarm?.date || localDate(tomorrow);
    document.querySelectorAll('[name="alarm-weekday"]').forEach((input) => {
      input.checked = (alarm?.weekdays || [1, 2, 3, 4, 5]).includes(Number(input.value));
    });
    $('alarm-delete').hidden = !alarm;
    $('alarm-editor').hidden = false;
    editorFields();
    $('alarm-time').focus();
    $('alarm-editor').scrollIntoView({ block: 'nearest' });
  }
  function closeEditor() {
    $('alarm-editor').hidden = true;
    editId = null;
    $('alarm-add').focus();
  }
  function saveEditor() {
    const existing = alarms().find((alarm) => alarm.id === editId);
    const candidate = {
      id: editId || crypto.randomUUID(),
      label: $('alarm-label').value,
      time: $('alarm-time').value,
      repeat: $('alarm-repeat').value,
      date: $('alarm-date').value,
      enabled: existing?.enabled ?? true,
      weekdays: [...document.querySelectorAll('[name="alarm-weekday"]:checked')].map((input) =>
        Number(input.value)
      ),
    };
    const normalized = normalizeAlarms([candidate])[0];
    if (!normalized) return toast('请填写有效时间、日期，并至少选择一个重复星期。');
    if (normalized.repeat === 'once' && !nextOccurrence({ ...normalized, enabled: true }))
      return toast('请选择未来的日期和时间。');
    if (existing)
      getSettings().alarms = alarms().map((alarm) => (alarm.id === editId ? normalized : alarm));
    else {
      if (alarms().length >= ALARM_LIMIT) return toast('最多可保存 20 个闹钟。');
      getSettings().alarms = [...alarms(), normalized];
    }
    closeEditor();
    if (changed()) toast(isDesktop ? '闹钟已保存。' : '设置已保存；请在桌面版使用响铃。');
  }

  async function command(action) {
    const generation = ++request;
    const result = await native('alarm', { action });
    if (!result || !Array.isArray(result.active) || !Array.isArray(result.snoozed))
      throw new Error('无效闹钟状态');
    if (generation !== request) return result;
    view = result;
    connectionError = '';
    renderSummary();
    return view;
  }
  async function poll() {
    if (!isDesktop || busy) return;
    busy = true;
    try {
      const now = new Date();
      const currentContext = `${localDate(now)}:${now.getTimezoneOffset()}`;
      if (syncNeeded || Date.now() - lastPlan > 3600000 || context !== currentContext) {
        const planned = signature;
        await command({
          type: 'sync',
          occurrences: alarmSchedule(alarms(), now),
          enabled_ids: alarms()
            .filter((alarm) => alarm.enabled)
            .map((alarm) => alarm.id),
        });
        lastPlan = Date.now();
        context = currentContext;
        syncNeeded = planned !== signature;
      } else if (
        Date.now() < previewUntil ||
        alarms().some((alarm) => alarm.enabled) ||
        view.active?.length ||
        view.snoozed?.length
      ) {
        await command({ type: 'status' });
      }
    } catch {
      connectionError = '闹钟未就绪，请重新启动应用后检查。';
    } finally {
      busy = false;
      renderSummary();
    }
  }
  async function act(type) {
    try {
      if (type === 'preview') previewUntil = Date.now() + 6000;
      await command({ type });
      if (type === 'snooze') toast('5 分钟后再次提醒；请保持应用运行。');
      if (type === 'preview') toast(view.error || '试听 5 秒。音量受系统设置影响。');
    } catch {
      toast('闹钟操作失败，请重试。');
    }
  }
  $('alarm-add').addEventListener('click', () => openEditor());
  $('alarm-cancel').addEventListener('click', closeEditor);
  $('alarm-save').addEventListener('click', saveEditor);
  $('alarm-delete').addEventListener('click', () => {
    getSettings().alarms = alarms().filter((alarm) => alarm.id !== editId);
    closeEditor();
    changed();
  });
  $('alarm-repeat').addEventListener('change', editorFields);
  $('alarm-editor').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
      event.preventDefault();
      saveEditor();
    }
  });
  $('alarm-next').addEventListener('click', () => openSettings('alarm'));
  $('alarm-preview').addEventListener('click', () => act('preview'));
  $('alarm-stop').addEventListener('click', () => act('stop'));
  $('alarm-snooze').addEventListener('click', () => act('snooze'));
  $('alarm-alert').addEventListener('cancel', (event) => event.preventDefault());
  $('settings-dialog').addEventListener('close', () => {
    $('alarm-editor').hidden = true;
    editId = null;
  });
  setInterval(poll, 1000);
  document.addEventListener('visibilitychange', poll);
  render();
  return { render };
}
