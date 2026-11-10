import { initializeNetease } from './netease.js';
import { createMusicScene } from './music-scene.js';
import { createMusicMeter } from './music-meter.js';

export function initializeMusic({ toast, resetIdle, openAccount }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('music-panel');
  const meter = createMusicMeter();
  const scene = createMusicScene(panel, meter);
  let ready,
    authenticated = false,
    view = 'player';
  const labels = {
    stopped: '未播放',
    connecting: '连接中',
    playing: '播放中',
    paused: '已暂停',
    ended: '已播完',
    error: '播放失败',
  };
  const netease = initializeNetease({
    toast,
    changed(value, { busy, error }) {
      authenticated = value.authenticated;
      const p = value.playback;
      const playing = ['playing', 'connecting'].includes(p.state);
      panel.dataset.state = p.state;
      scene.update({ state: p.state, volume: p.volume / 100 });
      $('music-title').textContent = p.track?.name || '还未选曲';
      $('music-title').title = p.track?.name || '';
      $('music-subtitle').textContent =
        p.track?.artist || (authenticated ? '从歌单开始播放' : '登录后选择歌单');
      $('music-subtitle').title = p.track?.artist || '';
      $('music-status').textContent = busy ? '处理中' : labels[p.state] || '未播放';
      $('music-help').textContent = error;
      $('music-help').hidden = !error;
      $('music-account-open').hidden = authenticated;
      $('music-toggle').disabled = busy || !p.track;
      $('music-toggle').setAttribute('aria-label', playing ? '暂停歌曲' : '播放歌曲');
      $('music-toggle').title = playing ? '暂停歌曲' : '播放歌曲';
      $('music-toggle-icon').setAttribute('href', playing ? '#icon-pause' : '#icon-play');
      $('music-volume').value = p.volume;
      $('music-volume').disabled = busy || !p.track;
      $('music-volume-value').textContent = `${p.volume}%`;
      $('music-volume-toggle').disabled = busy || !p.track;
      $('music-volume-toggle').title = `音量：${p.volume}%`;
      $('music-volume-toggle').setAttribute('aria-label', `音量：${p.volume}%`);
      $('music-open').classList.toggle('music-active', playing);
      if (!authenticated && view !== 'player') setLibrary(false);
    },
  });
  function ensureReady() {
    ready ??= netease.activate();
    return ready;
  }
  function setLibrary(open) {
    setView(open ? 'library' : 'player');
  }
  function setView(next) {
    view = next;
    const library = view !== 'player';
    $('netease-library').hidden = !library;
    $('music-now-playing').hidden = library;
    $('music-library-label').textContent = view === 'library' ? '返回播放' : '我的歌单';
    $('music-library-icon').setAttribute(
      'href',
      view === 'library' ? '#icon-back' : '#icon-library'
    );
    $('music-library-toggle').setAttribute('aria-expanded', String(view === 'library'));
    $('music-library-toggle').setAttribute(
      'aria-label',
      view === 'library' ? '返回播放' : '打开我的歌单'
    );
    $('music-queue-toggle').setAttribute('aria-expanded', String(view === 'queue'));
    $('music-queue-toggle').setAttribute(
      'aria-label',
      view === 'queue' ? '返回播放' : '打开当前播放列表'
    );
    $('music-current-list-heading').hidden = view !== 'queue';
    $('netease-tracks').setAttribute('aria-label', view === 'queue' ? '当前播放列表' : '歌单歌曲');
    panel.dataset.view = view;
    scene.setOpen(!panel.hidden && !library);
    resetIdle();
  }
  function setVolumeOpen(open, focus = false) {
    $('music-volume-panel').hidden = !open;
    $('music-volume-toggle').setAttribute('aria-expanded', String(open));
    if (focus) $(open ? 'music-volume' : 'music-volume-toggle').focus({ preventScroll: true });
  }
  async function account() {
    openAccount();
    await ensureReady();
    const action = authenticated ? $('netease-logout') : $('netease-connect');
    if (!action.hidden) action.focus({ preventScroll: false });
  }
  function toggle(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    document.body.classList.toggle('music-visible', open);
    $('music-open').setAttribute('aria-expanded', String(open));
    $('music-open').setAttribute('aria-label', open ? '收起音乐' : '展开音乐');
    $('music-open').title = `${open ? '收起音乐' : '展开音乐'} · M`;
    if (open) ensureReady();
    else {
      setLibrary(false);
      setVolumeOpen(false);
      $('music-open').focus({ preventScroll: true });
    }
    scene.setOpen(open && view === 'player');
    resetIdle();
  }
  $('music-open').addEventListener('click', () => toggle());
  $('music-account-open').addEventListener('click', account);
  $('music-library-toggle').addEventListener('click', async () => {
    await ensureReady();
    if (panel.hidden) return;
    if (!authenticated) return account();
    setLibrary(view !== 'library');
  });
  $('music-fm').addEventListener('click', async () => {
    if (await netease.fm()) {
      setLibrary(false);
      $('music-fm').focus({ preventScroll: true });
    }
  });
  $('music-queue-toggle').addEventListener('click', () =>
    setView(view === 'queue' ? 'player' : 'queue')
  );
  $('music-volume-toggle').addEventListener('click', () =>
    setVolumeOpen($('music-volume-panel').hidden, true)
  );
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.music-volume-control')) setVolumeOpen(false);
  });
  $('music-toggle').addEventListener('click', () => netease.toggle());
  $('music-volume').addEventListener('input', (event) => {
    $('music-volume-value').textContent = `${event.target.value}%`;
  });
  $('music-volume').addEventListener('change', (event) =>
    netease.volume(Number(event.target.value))
  );
  $('settings-dialog').addEventListener('close', () => netease.cancelLogin());
  window.addEventListener('pagehide', () => {
    netease.dispose();
    scene.dispose();
    meter.dispose();
  });
  setView('player');
  return {
    toggle,
    ensureReady,
    isOpen: () => !panel.hidden,
    closeLibrary() {
      if (!$('music-volume-panel').hidden) {
        setVolumeOpen(false, true);
        return true;
      }
      if (view === 'player') return false;
      setLibrary(false);
      $('music-library-toggle').focus({ preventScroll: true });
      return true;
    },
  };
}
