import { isDesktop, native } from './desktop.js';
import {
  createMusicQueue,
  readMode,
  PLAY_MODES,
  MODE_LABELS,
  MUSIC_PREFERENCES_KEY,
} from './music-queue.js';

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
    queue: 'playlist',
  };
  let active = false,
    busy = false,
    timer,
    generation = 0,
    error = '',
    listSignature = '',
    trackSignature = '',
    loginPending = false,
    cancelRequested = false;
  let commands = Promise.resolve();
  let mode = readMode(localStorage);
  const history = createMusicQueue();
  const effectiveMode = () => (value.queue === 'fm' ? 'order' : mode);
  function schedule() {
    clearTimeout(timer);
    if (!active || busy || !isDesktop) return;
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
        new Option('随心听', '__fm__'),
        ...value.playlists.map((p) => new Option(`${p.name} · ${p.count}`, p.id))
      );
    }
    $('netease-playlists').value = value.queue === 'fm' ? '__fm__' : value.playlist || '';
    $('netease-list-label').textContent = value.queue === 'fm' ? '随心听' : '我的歌单';
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
    $('netease-more').hidden =
      value.queue === 'fm' || !value.playlist || value.tracks.length >= value.total;
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
    const looping = ['loop', 'one'].includes(effectiveMode());
    $('netease-previous').disabled =
      busy ||
      !value.playback.track ||
      !(effectiveMode() === 'shuffle'
        ? history.hasPrevious()
        : index > 0 || (index === 0 && looping));
    $('netease-next').disabled =
      busy ||
      index < 0 ||
      (value.queue !== 'fm' &&
        mode === 'order' &&
        index >= value.tracks.length - 1 &&
        value.tracks.length >= value.total);
    $('music-mode').disabled = busy || !available || value.queue === 'fm';
    const modeLabel = value.queue === 'fm' ? '随心听' : MODE_LABELS[mode];
    $('music-mode').setAttribute('aria-label', `播放模式：${modeLabel}`);
    $('music-mode').title =
      value.queue === 'fm' ? '推荐会自动续接' : `播放模式：${modeLabel}，点击切换`;
    $('music-mode-label').textContent = modeLabel;
    $('music-mode-icon').setAttribute('href', `#icon-${value.queue === 'fm' ? 'fm' : mode}`);
    $('music-fm').hidden = !available || !value.authenticated;
    $('music-fm').disabled = busy;
    $('music-fm').setAttribute('aria-pressed', String(value.queue === 'fm'));
    $('music-queue-label').textContent = value.queue === 'fm' ? '随心听' : '';
    $('music-queue-label').hidden = value.queue !== 'fm';
    $('netease-shuffle').hidden = value.queue === 'fm';
    $('netease-shuffle').disabled = busy || !value.playlist || !value.tracks.length;
    $('netease-progress').textContent =
      `${clock(value.playback.seconds)} / ${clock(value.playback.duration)}`;
    const message = error || (value.login === 'expired' ? '二维码已过期' : '');
    $('netease-account-help').textContent = message;
    $('netease-account-help').hidden = !message;
    changed(value, { busy, error: message });
  }
  async function request(action, token) {
    const pending = commands.catch(() => {}).then(() => native('netease', { action }));
    commands = pending;
    const response = await pending;
    if (token !== generation || !active) throw new Error('Cancelled');
    value = response;
    history.sync(value.queue === 'fm' ? 'fm' : value.playlist, value.tracks);
  }
  async function allTracks(token) {
    while (value.queue !== 'fm' && value.playlist && value.tracks.length < value.total) {
      const before = value.tracks.length;
      await request({ type: 'tracks', playlist: value.playlist, offset: before }, token);
      if (value.tracks.length <= before) throw '歌单未能完整载入，请重试';
    }
  }
  function setMode(next) {
    mode = next;
    history.resetShuffle(value.playback.track?.id);
    try {
      localStorage.setItem(MUSIC_PREFERENCES_KEY, JSON.stringify({ mode }));
    } catch {
      toast('播放模式未能保存');
    }
    render();
  }
  async function run(action) {
    if (!active || !isDesktop || busy) return false;
    const token = generation;
    if (action.type === 'login') loginPending = true;
    let automatic = false,
      playId;
    busy = true;
    clearTimeout(timer);
    if (action.type !== 'status') error = '';
    if (!['status', 'poll_login'].includes(action.type)) render();
    async function play(id, direction = 'select') {
      if (!id) return;
      playId = id;
      await request({ type: 'play', id }, token);
      history.record(id, direction);
    }
    try {
      if (action.type === 'play') await play(action.id);
      else if (action.type === 'shuffle') {
        setMode('shuffle');
        await allTracks(token);
        await play(history.next(value.playback.track?.id, 'shuffle'));
      } else if (action.type === 'fm') {
        if (value.queue !== 'fm') {
          await request({ type: 'fm', append: false }, token);
          await play(value.tracks[0]?.id);
        }
      } else if (action.type === 'next') {
        const current = value.playback.track?.id;
        const index = value.tracks.findIndex((track) => track.id === current);
        if (value.queue === 'fm' && index === value.tracks.length - 1)
          await request({ type: 'fm', append: true }, token);
        else if (mode === 'shuffle') await allTracks(token);
        else if (
          !(action.automatic && mode === 'one') &&
          index === value.tracks.length - 1 &&
          value.tracks.length < value.total
        )
          await request(
            { type: 'tracks', playlist: value.playlist, offset: value.tracks.length },
            token
          );
        await play(history.next(current, effectiveMode(), action.automatic), 'next');
      } else if (action.type === 'previous') {
        await play(history.previous(value.playback.track?.id, effectiveMode()), 'previous');
      } else {
        await request(action, token);
        if (action.type === 'logout') toast('已退出本机网易云登录');
        if (action.type === 'status' && value.playback.state === 'ended' && !error)
          automatic = true;
      }
      return true;
    } catch (reason) {
      if (token !== generation || !active) return false;
      error = typeof reason === 'string' ? reason : '音乐暂不可用，请重试';
      if (playId || action.type === 'status') {
        const track = value.tracks.find((track) => track.id === playId) || value.playback.track;
        value = { ...value, playback: { ...value.playback, track, state: 'error' } };
      }
      return false;
    } finally {
      if (action.type === 'login') loginPending = false;
      if (token === generation && active) {
        busy = false;
        render();
        if (cancelRequested) {
          cancelRequested = false;
          timer = setTimeout(() => run({ type: 'cancel_login' }), 0);
        } else if (automatic) timer = setTimeout(() => run({ type: 'next', automatic: true }), 0);
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
    if (event.target.value === '__fm__') run({ type: 'fm' });
    else if (event.target.value) run({ type: 'tracks', playlist: event.target.value, offset: 0 });
  });
  $('netease-more').addEventListener('click', () =>
    run({ type: 'tracks', playlist: value.playlist, offset: value.tracks.length })
  );
  $('netease-previous').addEventListener('click', () => run({ type: 'previous' }));
  $('netease-next').addEventListener('click', () => run({ type: 'next' }));
  $('netease-shuffle').addEventListener('click', () => run({ type: 'shuffle' }));
  $('music-mode').addEventListener('click', () => {
    if (!busy && value.queue !== 'fm')
      setMode(PLAY_MODES[(PLAY_MODES.indexOf(mode) + 1) % PLAY_MODES.length]);
  });
  return {
    async activate() {
      active = true;
      generation++;
      error = '';
      render();
      await run({ type: 'restore' });
    },
    cancelLogin() {
      if (value.qr || loginPending) {
        if (busy) {
          cancelRequested = true;
          return;
        }
        return run({ type: 'cancel_login' });
      }
    },
    fm() {
      return run({ type: 'fm' });
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
