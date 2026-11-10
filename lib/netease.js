import { isDesktop, native } from './desktop.js';

const idle = () => ({ state: 'stopped', track: null, seconds: 0, duration: 0, volume: 50 });
const clock = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// This module only renders sanitized native view models. Cookies and stream URLs stay native.
export function initializeNetease({ changed, toast }) {
  const $ = (id) => document.getElementById(id);
  let value = {
    authenticated: false,
    login: 'idle',
    playlists: [],
    tracks: [],
    total: 0,
    playback: idle(),
  };
  let active = false,
    busy = false,
    timer,
    generation = 0,
    error = '',
    listSignature = '',
    trackSignature = '',
    loginPending = false;
  let queue = Promise.resolve();
  function schedule() {
    clearTimeout(timer);
    if (!active || busy || !isDesktop || error) return;
    if (['waiting', 'confirm'].includes(value.login))
      timer = setTimeout(() => run({ type: 'poll_login' }), 3000);
    else if (['connecting', 'playing', 'paused'].includes(value.playback.state))
      timer = setTimeout(() => run({ type: 'status' }), 1000);
  }
  function render() {
    if (!active) return;
    const available = isDesktop;
    $('netease-account-status').textContent = !available
      ? '桌面版可用'
      : value.authenticated
        ? '已登录'
        : '未登录';
    $('netease-connect').hidden = !available || value.authenticated || !!value.qr;
    $('netease-connect').textContent = value.login === 'expired' ? '重新扫码' : '扫码登录';
    $('netease-connect').disabled = busy;
    $('netease-logout').hidden = !value.authenticated;
    $('netease-logout').disabled = busy;
    $('netease-refresh').hidden = !error || !available;
    $('netease-refresh').disabled = busy;
    $('netease-login').hidden = !value.qr;
    if (value.qr) $('netease-qr').src = value.qr;
    else $('netease-qr').removeAttribute('src');
    $('netease-login-status').textContent =
      value.login === 'confirm' ? '请在手机上确认登录' : '用手机网易云音乐扫码';
    $('netease-browser').hidden = !value.authenticated;
    const lists = JSON.stringify(value.playlists);
    if (lists !== listSignature) {
      listSignature = lists;
      $('netease-playlists').replaceChildren(
        new Option('选择歌单', ''),
        ...value.playlists.map((p) => new Option(`${p.name} · ${p.count}`, p.id))
      );
    }
    $('netease-playlists').value = value.playlist || '';
    $('netease-playlists').disabled = busy;
    const tracks = JSON.stringify([value.playlist, value.tracks]);
    if (tracks !== trackSignature) {
      trackSignature = tracks;
      $('netease-tracks').replaceChildren(
        ...value.tracks.map((track, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.track = track.id;
          const title = document.createElement('span');
          title.textContent = `${String(index + 1).padStart(2, '0')}  ${track.name}`;
          const artist = document.createElement('small');
          artist.textContent = track.artist;
          button.append(title, artist);
          button.addEventListener('click', () => run({ type: 'play', id: track.id }));
          return button;
        })
      );
    }
    for (const button of $('netease-tracks').children) {
      button.disabled = busy;
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.track === value.playback.track?.id)
      );
    }
    $('netease-more').hidden = !value.playlist || value.tracks.length >= value.total;
    $('netease-more').disabled = busy;
    $('netease-empty').hidden = value.tracks.length > 0;
    $('netease-empty').textContent = value.playlist ? '歌单暂无可播放歌曲' : '选择一个歌单';
    $('netease-progress-group').hidden = !value.playback.track;
    const progress =
      value.playback.duration > 0 ? (value.playback.seconds / value.playback.duration) * 100 : 0;
    $('music-progress').value = Math.min(100, Math.max(0, progress));
    $('music-progress').setAttribute(
      'aria-valuetext',
      `${clock(value.playback.seconds)} / ${clock(value.playback.duration)}`
    );
    const index = value.tracks.findIndex((t) => t.id === value.playback.track?.id);
    $('netease-previous').disabled = busy || index <= 0;
    $('netease-next').disabled = busy || index < 0 || index >= value.tracks.length - 1;
    $('netease-progress').textContent =
      `${clock(value.playback.seconds)} / ${clock(value.playback.duration)}`;
    const message = error || (value.login === 'expired' ? '二维码已过期' : '');
    $('netease-account-help').textContent = message;
    $('netease-account-help').hidden = !message;
    changed(value, { busy, error: message });
  }
  async function run(action) {
    if (!active || !isDesktop) return;
    const token = generation;
    if (action.type === 'login') loginPending = true;
    let nextTrack;
    busy = true;
    clearTimeout(timer);
    error = '';
    if (!['status', 'poll_login'].includes(action.type)) render();
    // Serialize controls with polling, including slow API responses.
    const request = queue.catch(() => {}).then(() => native('netease', { action }));
    queue = request;
    try {
      const response = await request;
      if (token !== generation || !active) return;
      value = response;
      if (action.type === 'logout') toast('已退出本机网易云登录');
      if (value.playback.state === 'ended' && action.type === 'status') {
        const index = value.tracks.findIndex((t) => t.id === value.playback.track?.id);
        if (index >= 0 && index + 1 < value.tracks.length) {
          nextTrack = value.tracks[index + 1].id;
        }
      }
    } catch (reason) {
      if (token !== generation || !active) return;
      error = typeof reason === 'string' ? reason : '音乐暂不可用，请重试';
      value = { ...value, playback: { ...value.playback, state: 'error' } };
      // Native failures never fall back to a web player or another account.
    } finally {
      if (action.type === 'login') loginPending = false;
      if (token === generation && active) {
        busy = false;
        render();
        if (nextTrack) timer = setTimeout(() => run({ type: 'play', id: nextTrack }), 0);
        else schedule();
      }
    }
  }
  $('netease-connect').addEventListener('click', () => run({ type: 'login' }));
  $('netease-refresh').addEventListener('click', () =>
    run({ type: value.authenticated ? 'status' : 'restore' })
  );
  $('netease-cancel').addEventListener('click', () => run({ type: 'cancel_login' }));
  $('netease-logout').addEventListener('click', () => run({ type: 'logout' }));
  $('netease-playlists').addEventListener('change', (event) => {
    if (event.target.value) run({ type: 'tracks', playlist: event.target.value, offset: 0 });
  });
  $('netease-more').addEventListener('click', () =>
    run({ type: 'tracks', playlist: value.playlist, offset: value.tracks.length })
  );
  function step(delta) {
    const index = value.tracks.findIndex((t) => t.id === value.playback.track?.id);
    const next = index < 0 ? null : value.tracks[index + delta];
    if (next) return run({ type: 'play', id: next.id });
  }
  $('netease-previous').addEventListener('click', () => step(-1));
  $('netease-next').addEventListener('click', () => step(1));
  return {
    async activate() {
      active = true;
      generation++;
      error = '';
      render();
      await run({ type: 'restore' });
    },
    cancelLogin() {
      if (value.qr || loginPending) return run({ type: 'cancel_login' });
    },
    toggle() {
      if (busy) return;
      const { state, track } = value.playback;
      if (['playing', 'connecting'].includes(state)) return run({ type: 'pause', paused: true });
      if (state === 'paused') return run({ type: 'pause', paused: false });
      if (track) return run({ type: 'play', id: track.id });
    },
    volume(volume) {
      if (!busy && value.playback.track) return run({ type: 'volume', volume });
    },
    dispose() {
      active = false;
      generation++;
      clearTimeout(timer);
      if (isDesktop) native('netease', { action: { type: 'stop' } }).catch(() => {});
    },
  };
}
