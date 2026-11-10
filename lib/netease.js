import { isDesktop, native } from './desktop.js';
import {
  createMusicQueue,
  readPlaybackPreferences,
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
    cancelRequested = false,
    polling = false,
    queueView = false,
    advancePending = false;
  const pendingActions = [];
  let commands = Promise.resolve();
  let { shuffle, repeat } = readPlaybackPreferences(localStorage);
  const mode = () => (shuffle ? 'shuffle' : repeat);
  const history = createMusicQueue();
  const playbackQueue = () => value.playing_queue || value;
  const displayedQueue = () => (queueView ? playbackQueue() : value);
  const effectiveMode = () => (playbackQueue().queue === 'fm' ? 'order' : mode());
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
    const uiBusy = busy && !polling;
    const shown = displayedQueue();
    const playing = playbackQueue();
    $('netease-account-status').textContent = !available
      ? '桌面版可用'
      : value.authenticated
        ? '已登录'
        : '未登录';
    $('netease-connect').hidden = !available || value.authenticated || !!value.qr;
    $('netease-connect').textContent = value.login === 'expired' ? '重新扫码' : '扫码登录';
    $('netease-connect').disabled = uiBusy;
    $('netease-logout').hidden = !value.authenticated;
    $('netease-logout').disabled = uiBusy;
    $('netease-refresh').hidden = !error || !available;
    $('netease-refresh').disabled = uiBusy;
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
    $('netease-playlists').disabled = uiBusy;
    const tracks = JSON.stringify([queueView, shown.playlist, shown.tracks]);
    if (tracks !== trackSignature) {
      trackSignature = tracks;
      $('netease-tracks').replaceChildren(
        ...shown.tracks.map((track, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.track = track.id;
          const title = document.createElement('span');
          title.textContent = `${String(index + 1).padStart(2, '0')}  ${track.name}`;
          const artist = document.createElement('small');
          artist.textContent = track.artist;
          button.append(title, artist);
          button.addEventListener('click', () =>
            run({ type: 'play', id: track.id, from_queue: queueView && !!value.playing_queue })
          );
          return button;
        })
      );
    }
    for (const button of $('netease-tracks').children) {
      button.disabled = uiBusy;
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.track === value.playback.track?.id)
      );
    }
    $('netease-more').hidden =
      shown.queue === 'fm' || !shown.playlist || shown.tracks.length >= shown.total;
    $('netease-more').disabled = uiBusy;
    $('netease-empty').hidden = shown.tracks.length > 0;
    $('netease-empty').textContent = shown.playlist ? '歌单暂无可播放歌曲' : '选择一个歌单';
    $('netease-progress-group').hidden = !value.playback.track;
    const progress =
      value.playback.duration > 0 ? (value.playback.seconds / value.playback.duration) * 100 : 0;
    $('music-progress').value = Math.min(100, Math.max(0, progress));
    $('music-progress').setAttribute(
      'aria-valuetext',
      `${clock(value.playback.seconds)} / ${clock(value.playback.duration)}`
    );
    const index = playing.tracks.findIndex((t) => t.id === value.playback.track?.id);
    const looping = ['loop', 'one'].includes(effectiveMode());
    $('netease-previous').disabled =
      uiBusy ||
      !value.playback.track ||
      !(effectiveMode() === 'shuffle'
        ? history.hasPrevious()
        : index > 0 || (index === 0 && looping));
    $('netease-next').disabled =
      uiBusy ||
      index < 0 ||
      (playing.queue !== 'fm' &&
        playing.tracks.length >= playing.total &&
        (shuffle
          ? !history.hasNext(value.playback.track?.id, repeat)
          : repeat === 'order' && index >= playing.tracks.length - 1));
    const modesDisabled = uiBusy || !available || playing.queue === 'fm';
    $('music-shuffle').disabled = modesDisabled;
    $('music-shuffle').setAttribute('aria-pressed', String(shuffle && playing.queue !== 'fm'));
    $('music-shuffle').title =
      playing.queue === 'fm' ? '随心听按推荐顺序播放' : `${shuffle ? '关闭' : '开启'}随机播放`;
    $('music-repeat').disabled = modesDisabled;
    const repeatLabel = repeat === 'order' ? '关闭循环' : MODE_LABELS[repeat];
    $('music-repeat').setAttribute('aria-label', `循环模式：${repeatLabel}`);
    $('music-repeat').setAttribute(
      'aria-pressed',
      String(repeat !== 'order' && playing.queue !== 'fm')
    );
    $('music-repeat').title =
      playing.queue === 'fm' ? '推荐会自动续接' : `${repeatLabel}，点击切换`;
    $('music-repeat-icon').setAttribute('href', repeat === 'one' ? '#icon-one' : '#icon-loop');
    $('music-queue-toggle').disabled = uiBusy || !playing.tracks.length;
    $('music-fm').hidden = !available || !value.authenticated;
    $('music-fm').disabled = uiBusy;
    $('music-fm').setAttribute('aria-current', String(playing.queue === 'fm'));
    $('music-queue-label').textContent = playing.queue === 'fm' ? '随心听' : '';
    $('music-queue-label').hidden = playing.queue !== 'fm';
    $('netease-progress').textContent =
      `${clock(value.playback.seconds)} / ${clock(value.playback.duration)}`;
    const message = error || (value.login === 'expired' ? '二维码已过期' : '');
    $('netease-account-help').textContent = message;
    $('netease-account-help').hidden = !message;
    changed(value, { busy: uiBusy, error: message });
  }
  async function request(action, token) {
    const pending = commands.catch(() => {}).then(() => native('netease', { action }));
    commands = pending;
    const response = await pending;
    if (token !== generation || !active) throw new Error('Cancelled');
    value = response;
    const playing = playbackQueue();
    history.sync(playing.queue === 'fm' ? 'fm' : playing.playlist, playing.tracks);
  }
  async function loadQueuePage(token) {
    const playing = playbackQueue();
    await request(
      {
        type: 'tracks',
        playlist: playing.playlist,
        offset: playing.tracks.length,
        from_queue: !!value.playing_queue,
      },
      token
    );
  }
  async function allTracks(token) {
    while (
      playbackQueue().queue !== 'fm' &&
      playbackQueue().playlist &&
      playbackQueue().tracks.length < playbackQueue().total
    ) {
      const before = playbackQueue().tracks.length;
      await loadQueuePage(token);
      if (playbackQueue().tracks.length <= before) throw '歌单未能完整载入，请重试';
    }
  }
  function savePreferences() {
    try {
      localStorage.setItem(MUSIC_PREFERENCES_KEY, JSON.stringify({ mode: mode(), repeat }));
    } catch {
      toast('播放模式未能保存');
    }
    render();
  }
  async function run(action) {
    if (!active || !isDesktop) return false;
    if (busy) {
      if (['status', 'poll_login'].includes(action.type)) return false;
      return new Promise((resolve) => pendingActions.push({ action, token: generation, resolve }));
    }
    const token = generation;
    if (action.type === 'login') loginPending = true;
    let playId;
    busy = true;
    polling = ['status', 'poll_login'].includes(action.type);
    clearTimeout(timer);
    if (action.type !== 'status') error = '';
    if (!['status', 'poll_login'].includes(action.type)) render();
    async function play(id, direction = 'select', fromQueue = direction !== 'select') {
      if (!id) return;
      playId = id;
      if (!fromQueue) {
        value = {
          ...value,
          playing_queue: {
            playlist: value.playlist,
            tracks: value.tracks,
            total: value.total,
            queue: value.queue,
          },
        };
        const playing = playbackQueue();
        history.sync(playing.queue === 'fm' ? 'fm' : playing.playlist, playing.tracks);
      }
      await request({ type: 'play', id, from_queue: fromQueue }, token);
      history.record(id, direction);
    }
    try {
      if (action.type === 'play') await play(action.id, 'select', !!action.from_queue);
      else if (action.type === 'toggle') {
        const { state, track } = value.playback;
        if (['playing', 'connecting', 'paused'].includes(state))
          await request({ type: 'pause', paused: state !== 'paused' }, token);
        else if (track) await play(track.id, 'replay');
      } else if (action.type === 'fm') {
        if (playbackQueue().queue !== 'fm' || !value.playing_queue) {
          await request({ type: 'fm', append: false }, token);
          await play(value.tracks[0]?.id);
        }
      } else if (action.type === 'next') {
        const current = value.playback.track?.id;
        const index = playbackQueue().tracks.findIndex((track) => track.id === current);
        if (playbackQueue().queue === 'fm' && index === playbackQueue().tracks.length - 1)
          await request({ type: 'fm', append: true }, token);
        else if (shuffle) await allTracks(token);
        else if (
          !(action.automatic && repeat === 'one') &&
          index === playbackQueue().tracks.length - 1 &&
          playbackQueue().tracks.length < playbackQueue().total
        )
          await loadQueuePage(token);
        await play(
          history.next(
            current,
            effectiveMode(),
            action.automatic,
            playbackQueue().queue === 'fm' ? 'order' : repeat
          ),
          'next'
        );
      } else if (action.type === 'previous') {
        await play(history.previous(value.playback.track?.id, effectiveMode()), 'previous');
      } else {
        await request(action, token);
        if (action.type === 'logout') toast('已退出本机网易云登录');
        if (action.type === 'status' && value.playback.state === 'ended' && !error)
          advancePending = true;
      }
      return true;
    } catch (reason) {
      if (token !== generation || !active) return false;
      error = typeof reason === 'string' ? reason : '音乐暂不可用，请重试';
      if (playId || action.type === 'status') {
        const track =
          [...playbackQueue().tracks, ...value.tracks].find((track) => track.id === playId) ||
          value.playback.track;
        value = { ...value, playback: { ...value.playback, track, state: 'error' } };
      }
      return false;
    } finally {
      if (action.type === 'login') loginPending = false;
      if (token === generation && active) {
        busy = false;
        polling = false;
        render();
        if (cancelRequested) {
          cancelRequested = false;
          run({ type: 'cancel_login' });
        } else if (pendingActions.length) {
          const pending = pendingActions.shift();
          if (pending.token !== generation || !active) pending.resolve(false);
          else run(pending.action).then(pending.resolve);
        } else if (advancePending) {
          advancePending = false;
          if (value.playback.state === 'ended' && !error) run({ type: 'next', automatic: true });
          else schedule();
        } else schedule();
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
    run({
      type: 'tracks',
      playlist: displayedQueue().playlist,
      offset: displayedQueue().tracks.length,
      from_queue: queueView && !!value.playing_queue,
    })
  );
  $('netease-previous').addEventListener('click', () => run({ type: 'previous' }));
  $('netease-next').addEventListener('click', () => run({ type: 'next' }));
  $('music-shuffle').addEventListener('click', () => {
    if ((busy && !polling) || playbackQueue().queue === 'fm') return;
    shuffle = !shuffle;
    history.resetShuffle(value.playback.track?.id);
    savePreferences();
  });
  $('music-repeat').addEventListener('click', () => {
    if ((busy && !polling) || playbackQueue().queue === 'fm') return;
    const repeats = ['order', 'loop', 'one'];
    repeat = repeats[(repeats.indexOf(repeat) + 1) % repeats.length];
    savePreferences();
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
      return run({ type: 'toggle' });
    },
    volume(volume) {
      if (value.playback.track) return run({ type: 'volume', volume });
    },
    setQueueView(show) {
      queueView = show;
      render();
    },
    dispose() {
      active = false;
      generation++;
      for (const pending of pendingActions.splice(0)) pending.resolve(false);
      clearTimeout(timer);
      if (isDesktop) native('netease', { action: { type: 'stop' } }).catch(() => {});
    },
  };
}
