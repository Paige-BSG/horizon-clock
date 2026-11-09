import { createRadioScene } from './radio-scene.js';
import { createRadioMeter } from './radio-meter.js';
import { isDesktop, native } from './desktop.js';
import { createRadio, radioPreferences, RADIO_KEY, RADIO_SOURCE, STATIONS } from './radio.js';

export function initializeMusic({ toast, resetIdle }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('music-panel');
  const channels = $('music-channels');
  const meter = createRadioMeter();
  const scene = createRadioScene(panel, meter);
  let support = isDesktop ? 'unknown' : 'ready';
  let supportVersion = 0;
  let preferences;
  try {
    preferences = radioPreferences(JSON.parse(localStorage.getItem(RADIO_KEY)));
  } catch {
    preferences = radioPreferences();
  }
  for (const station of STATIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.station = station.id;
    button.setAttribute('aria-label', station.label);
    const number = document.createElement('span');
    number.className = 'channel-number';
    number.setAttribute('aria-hidden', 'true');
    number.textContent = String(STATIONS.indexOf(station) + 1).padStart(2, '0');
    const label = document.createElement('span');
    label.textContent = station.label;
    button.append(number, label);
    button.title = station.name;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      radio.select(station.id);
      save();
    });
    channels.append(button);
  }
  const labels = {
    stopped: '未播放',
    connecting: '连接中',
    playing: '播放中',
    buffering: '缓冲中',
    retrying: '正在重连',
    error: '连接失败',
    gesture: '请点击播放',
  };
  function render(value) {
    $('music-status').textContent = labels[value.state];
    if (!value.requested && support !== 'ready')
      $('music-status').textContent = support === 'error' ? '设备音频暂不可用' : '检查音频';
    $('music-toggle').disabled = !value.requested && support !== 'ready';
    for (const button of channels.children)
      button.setAttribute('aria-pressed', String(button.dataset.station === value.station));
    panel.dataset.state = value.state;
    scene.update(value);
    $('music-title').textContent = value.stationInfo.label;
    $('music-subtitle').textContent = value.stationInfo.name.split(' · ')[1];
    $('music-index').textContent = String(STATIONS.indexOf(value.stationInfo) + 1).padStart(2, '0');
    $('music-volume').value = Math.round(value.volume * 100);
    $('music-volume-value').textContent = `${Math.round(value.volume * 100)}%`;
    $('music-toggle').setAttribute('aria-label', value.requested ? '停止电台' : '播放电台');
    $('music-toggle').title = value.requested ? '停止电台' : '播放电台';
    $('music-toggle-icon').setAttribute('href', value.requested ? '#icon-stop' : '#icon-play');
    $('music-open').classList.toggle('music-active', value.requested);
    const help =
      support === 'error'
        ? '缺少音频组件，请安装后重试。'
        : value.state === 'error'
          ? '连接失败，请换台或重试。'
          : value.state === 'gesture'
            ? '请再次点击播放。'
            : '';
    $('music-help').textContent = help;
    $('music-help').hidden = !help;
  }
  const radio = createRadio({
    preferences,
    changed: render,
    audioFactory: () => {
      const audio = document.createElement('audio');
      audio.id = 'radio-stream';
      meter.attach(audio);
      audio.hidden = true;
      document.body.append(audio);
      return audio;
    },
  });
  render(radio.snapshot());
  function save() {
    const { station, volume } = radio.snapshot();
    try {
      localStorage.setItem(RADIO_KEY, JSON.stringify({ station, volume }));
    } catch {
      toast('电台偏好未能保存，本次播放仍可使用。');
    }
  }
  function toggle(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    document.body.classList.toggle('music-visible', open);
    scene.setOpen(open);
    $('music-open').setAttribute('aria-expanded', String(open));
    const version = ++supportVersion;
    if (open && isDesktop && !radio.snapshot().requested) {
      support = 'checking';
      render(radio.snapshot());
      native('check_radio_audio')
        .then(() => {
          if (version !== supportVersion) return;
          support = 'ready';
          render(radio.snapshot());
        })
        .catch(() => {
          if (version !== supportVersion) return;
          support = 'error';
          render(radio.snapshot());
        });
    }
    if (!open) $('music-open').focus({ preventScroll: true });
    resetIdle();
  }
  $('music-open').addEventListener('click', () => toggle());
  $('music-close').addEventListener('click', () => toggle(false));
  $('music-toggle').addEventListener('click', () => {
    if (radio.snapshot().requested) radio.stop();
    else radio.play();
  });
  $('music-volume').addEventListener('input', (event) =>
    radio.volume(Number(event.target.value) / 100)
  );
  $('music-volume').addEventListener('change', save);
  $('music-source').addEventListener('click', async (event) => {
    if (!isDesktop) return;
    event.preventDefault();
    try {
      await native('open_radio_source');
    } catch {
      toast('未能打开电台来源，请稍后重试。');
    }
  });
  $('music-source').href = RADIO_SOURCE;
  window.addEventListener('pagehide', () => {
    scene.dispose();
    meter.dispose();
    radio.dispose();
  });
  return { toggle, isOpen: () => !panel.hidden };
}
