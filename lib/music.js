import { isDesktop, native } from './desktop.js';

export function initializeMusic({ toast, resetIdle }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('music-panel');
  const selector = $('music-player');
  let players = [];
  let selected = '';
  let supported = null;
  let error = '';
  let busy = false;
  let request = null;
  let timer;
  let revision = 0;
  const visible = () => !panel.hidden && document.visibilityState === 'visible';
  const key = (player) => `${player.id}|${player.owner}`;
  const current = () => players.find((player) => key(player) === selected);

  function render() {
    const player = current();
    const unavailable = supported === false;
    const disconnected = selected && !player;
    $('music-title').textContent = player?.title || (player ? '尚未选择歌曲' : '音乐，留在此刻');
    $('music-artist').textContent = player
      ? [player.artist, player.name].filter(Boolean).join(' · ')
      : unavailable
        ? '音乐联动需要 Linux 桌面版'
        : error || (disconnected ? '播放器已断开连接' : '等待播放器');
    $('music-status').textContent = player
      ? player.status === 'Playing'
        ? '正在播放'
        : player.status === 'Paused'
          ? '已暂停'
          : '已停止'
      : '未连接';
    $('music-help').hidden = !!player;
    $('music-help').textContent = unavailable
      ? '请在 Linux 桌面版使用。浏览器预览无法控制本机播放器。'
      : error
        ? '请检查播放器和桌面会话。连接恢复后会自动重试。'
        : players.length > 1 && !selected
          ? '检测到多个播放器。请选择要控制的播放器。'
          : '先在同一台设备的网易云官方播放器登录并播放一首歌，再回到时钟。也可使用支持系统媒体控制的官方网页。';
    const options = [];
    if (!player) {
      const placeholder = document.createElement('option');
      placeholder.value = selected;
      placeholder.textContent = disconnected ? '播放器已断开' : '选择播放器';
      options.push(placeholder);
    }
    for (const item of players) {
      const option = document.createElement('option');
      option.value = key(item);
      option.textContent = item.name;
      options.push(option);
    }
    // Keep keyboard selection stable across background refreshes.
    const signature = JSON.stringify(options.map((option) => [option.value, option.textContent]));
    if (selector.dataset.options !== signature) {
      selector.replaceChildren(...options);
      selector.dataset.options = signature;
    }
    selector.value = selected;
    selector.disabled = busy || !players.length;
    selector.hidden = players.length < 2 && !disconnected;
    $('music-toggle').disabled = busy || !player?.canToggle;
    $('music-previous').disabled = busy || !player?.canPrevious;
    $('music-next').disabled = busy || !player?.canNext;
    const playing = player?.status === 'Playing';
    $('music-toggle').setAttribute('aria-label', playing ? '暂停音乐' : '播放音乐');
    $('music-toggle').title = playing ? '暂停音乐' : '播放音乐';
    $('music-toggle-icon').setAttribute('href', playing ? '#icon-pause' : '#icon-play');
    panel.setAttribute('aria-busy', String(busy));
  }

  function schedule() {
    clearTimeout(timer);
    if (visible() && !busy && supported !== false) timer = setTimeout(refresh, 3000);
  }

  async function refresh() {
    clearTimeout(timer);
    if (!visible() || busy || request || supported === false) return;
    if (!isDesktop) {
      supported = false;
      render();
      return;
    }
    const token = revision;
    request = native('get_media_players');
    try {
      const snapshot = await request;
      if (token !== revision || !visible()) return;
      supported = snapshot.supported;
      players = snapshot.players;
      error = '';
      if (!selected && players.length === 1) selected = key(players[0]);
      render();
    } catch {
      if (token !== revision || !visible()) return;
      players = [];
      error = '暂时无法连接系统媒体服务';
      render();
    } finally {
      request = null;
      schedule();
    }
  }

  async function control(action) {
    const player = current();
    const allowed =
      player?.[{ toggle: 'canToggle', previous: 'canPrevious', next: 'canNext' }[action]];
    if (busy || !player || !allowed) return;
    busy = true;
    revision++;
    clearTimeout(timer);
    render();
    try {
      await native('control_media', { player: player.id, owner: player.owner, action });
    } catch {
      if (visible()) toast('音乐控制未完成。请检查播放器后重试。');
    } finally {
      // A pre-command poll must finish before reading the resulting state.
      await request?.catch(() => {});
      busy = false;
      render();
      await refresh();
    }
  }

  function toggle(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    document.body.classList.toggle('music-visible', open);
    $('music-open').setAttribute('aria-expanded', String(open));
    revision++;
    clearTimeout(timer);
    if (open) {
      render();
      refresh();
    } else {
      $('music-open').focus({ preventScroll: true });
    }
    resetIdle();
  }

  $('music-open').addEventListener('click', () => toggle());
  $('music-close').addEventListener('click', () => toggle(false));
  selector.addEventListener('change', () => {
    selected = selector.value;
    render();
  });
  for (const action of ['toggle', 'previous', 'next'])
    $(`music-${action}`).addEventListener('click', () => control(action));
  document.addEventListener('visibilitychange', () => {
    revision++;
    clearTimeout(timer);
    if (visible()) refresh();
  });
  return { toggle, isOpen: () => !panel.hidden };
}
