export const RADIO_KEY = 'horizon-radio-v1';
export const RADIO_SOURCE = 'https://radioparadise.com/listen/stream-links';
export const STATIONS = Object.freeze([
  { id: 'mellow', name: '舒缓 · Mellow Mix', url: 'https://stream.radioparadise.com/mellow-192' },
  { id: 'serenity', name: '静谧 · Serenity', url: 'https://stream.radioparadise.com/serenity' },
  { id: 'main', name: '随心 · Main Mix', url: 'https://stream.radioparadise.com/mp3-192' },
]);
export function radioPreferences(value) {
  return {
    station: STATIONS.some((station) => station.id === value?.station) ? value.station : 'mellow',
    volume:
      typeof value?.volume === 'number' && Number.isFinite(value.volume)
        ? Math.min(1, Math.max(0, value.volume))
        : 0.3,
  };
}
export function createRadio({
  preferences,
  changed,
  audioFactory = () => new Audio(),
  timers = globalThis,
}) {
  let settings = radioPreferences(preferences);
  let state = 'stopped';
  let requested = false;
  let attempt = null;
  let retry = null;
  let failures = 0;
  const delays = [2000, 5000, 10000];
  const current = () => STATIONS.find((station) => station.id === settings.station);
  const snapshot = () => ({ ...settings, stationInfo: current(), state, requested, failures });
  const emit = () => changed?.(snapshot());
  function release() {
    if (!attempt) return;
    const old = attempt;
    attempt = null;
    timers.clearTimeout(old.timeout);
    for (const [type, handler] of old.handlers) old.audio.removeEventListener(type, handler);
    old.audio.pause();
    old.audio.removeAttribute('src');
    old.audio.load();
    old.audio.remove?.();
  }
  function stop(nextState = 'stopped') {
    requested = false;
    timers.clearTimeout(retry);
    retry = null;
    release();
    state = nextState;
    emit();
  }
  function failed(active, error) {
    if (attempt !== active || !requested) return;
    if (error?.name === 'NotAllowedError') {
      stop('gesture');
      return;
    }
    release();
    if (failures >= delays.length) {
      stop('error');
      return;
    }
    state = 'retrying';
    retry = timers.setTimeout(() => {
      retry = null;
      if (requested) connect();
    }, delays[failures++]);
    emit();
  }
  function connect() {
    release();
    const audio = audioFactory();
    const active = { audio, handlers: [], timeout: null, started: null };
    attempt = active;
    state = 'connecting';
    const on = (type, handler) => {
      const guarded = (event) => {
        if (attempt === active && requested) handler(event);
      };
      active.handlers.push([type, guarded]);
      audio.addEventListener(type, guarded);
    };
    const deadline = () => {
      if (active.timeout !== null) return;
      active.timeout = timers.setTimeout(() => {
        active.timeout = null;
        failed(active);
      }, 15000);
    };
    on('playing', () => {
      timers.clearTimeout(active.timeout);
      active.timeout = null;
      if (active.started === null) active.started = audio.currentTime;
      state = 'playing';
      emit();
    });
    on('timeupdate', () => {
      // Brief connections must not reset the retry budget indefinitely.
      if (active.started !== null && audio.currentTime - active.started >= 30) failures = 0;
    });
    on('waiting', () => {
      state = 'buffering';
      deadline();
      emit();
    });
    on('stalled', () => {
      if (state !== 'playing') deadline();
    });
    on('error', () => failed(active));
    on('ended', () => failed(active));
    audio.preload = 'none';
    audio.crossOrigin = 'anonymous';
    audio.volume = settings.volume;
    audio.src = current().url;
    deadline();
    emit();
    try {
      Promise.resolve(audio.play()).catch((error) => failed(active, error));
    } catch (error) {
      failed(active, error);
    }
  }
  function play() {
    if (requested) return;
    requested = true;
    failures = 0;
    connect();
  }
  function select(id) {
    if (!STATIONS.some((station) => station.id === id) || settings.station === id) return;
    settings = { ...settings, station: id };
    failures = 0;
    timers.clearTimeout(retry);
    retry = null;
    if (requested) connect();
    else {
      state = 'stopped';
      emit();
    }
  }
  function volume(value) {
    if (!Number.isFinite(value)) return;
    settings = { ...settings, volume: Math.min(1, Math.max(0, value)) };
    if (attempt) attempt.audio.volume = settings.volume;
    emit();
  }
  return { snapshot, play, stop, select, volume, dispose: () => stop() };
}
