import { isDesktop, native } from './desktop.js';
import { createRadio, radioPreferences, RADIO_KEY, RADIO_SOURCE, STATIONS } from './radio.js';

export function initializeMusic({ toast, resetIdle }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('music-panel');
  const selector = $('music-player');
  let support = isDesktop ? 'unknown' : 'ready';
  let supportVersion = 0;
  let preferences;
  try {
    preferences = radioPreferences(JSON.parse(localStorage.getItem(RADIO_KEY)));
  } catch {
    preferences = radioPreferences();
  }
  for (const station of STATIONS) {
    const option = document.createElement('option');
    option.value = station.id;
    option.textContent = station.name;
    selector.append(option);
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
    $('music-artist').textContent = 'Radio Paradise · 免登录直播电台';
    $('music-status').textContent = labels[value.state];
    if (!value.requested && support !== 'ready')
      $('music-status').textContent = support === 'error' ? '设备音频暂不可用' : '检查音频';
    $('music-toggle').disabled = !value.requested && support !== 'ready';
    selector.value = value.station;
    $('music-volume').value = Math.round(value.volume * 100);
    $('music-volume-value').textContent = `${Math.round(value.volume * 100)}%`;
    $('music-toggle').setAttribute('aria-label', value.requested ? '停止电台' : '播放电台');
    $('music-toggle').title = value.requested ? '停止电台' : '播放电台';
    $('music-toggle-icon').setAttribute('href', value.requested ? '#icon-stop' : '#icon-play');
    $('music-open').classList.toggle('music-active', value.requested);
    $('music-help').textContent =
      support === 'error'
        ? '本机缺少播放组件，时钟仍可使用。安装音频组件后，重新打开电台再试。'
        : value.state === 'error'
          ? '暂时无法连接。请检查网络，或换个频道再播放。'
          : value.state === 'gesture'
            ? '请再次点击播放，允许此窗口播放声音。'
            : value.state === 'retrying'
              ? `连接中断，正在尝试恢复（${value.failures}/3）。可随时停止或换台。`
              : value.requested
                ? '直播持续播放；收起控制栏仍可收听。再次播放会从当前节目开始。'
                : '点击播放后连接 Radio Paradise。按频道直播，不支持点播单曲。';
  }
  const radio = createRadio({
    preferences,
    changed: render,
    audioFactory: () => {
      const audio = document.createElement('audio');
      audio.id = 'radio-stream';
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
  selector.addEventListener('change', () => {
    radio.select(selector.value);
    save();
  });
  $('music-next').addEventListener('click', () => {
    const index = STATIONS.findIndex((station) => station.id === radio.snapshot().station);
    radio.select(STATIONS[(index + 1) % STATIONS.length].id);
    save();
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
  window.addEventListener('pagehide', () => radio.dispose());
  return { toggle, isOpen: () => !panel.hidden };
}
