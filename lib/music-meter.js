import { isDesktop, native } from './desktop.js';
const empty = () => ({
  available: false,
  rms: 0,
  energy: 0,
  bass: 0,
  mid: 0,
  high: 0,
  bands: new Float32Array(24),
  waveform: new Float32Array(64),
});
export function createMusicMeter() {
  let value = empty(),
    active = false,
    disposed = false,
    timer,
    version = 0;
  let queue = Promise.resolve();
  function reset() {
    value = empty();
  }
  function poll(token) {
    if (!active || disposed || token !== version) return;
    native('music_audio_levels')
      .then((levels) => {
        if (token !== version || !active || disposed) return;
        value =
          levels?.length === 93
            ? {
                available: true,
                rms: levels[0],
                energy: levels[1],
                bass: levels[2],
                mid: levels[3],
                high: levels[4],
                bands: Float32Array.from(levels.slice(5, 29)),
                waveform: Float32Array.from(levels.slice(29, 93)),
              }
            : empty();
      })
      .catch(() => {
        if (token === version) reset();
      })
      .finally(() => {
        if (active && !disposed && token === version) timer = setTimeout(() => poll(token), 50);
      });
  }
  function setActive(enabled) {
    enabled = Boolean(enabled) && !disposed;
    if (enabled === active) return;
    active = enabled;
    const token = ++version;
    clearTimeout(timer);
    reset();
    if (isDesktop) {
      queue = queue
        .catch(() => {})
        .then(() => native('set_music_meter', { enabled: active }))
        .then(() => {
          if (active && !disposed && token === version) poll(token);
        })
        .catch(() => {});
    }
  }
  return {
    setActive,
    sample() {
      return value;
    },
    dispose() {
      setActive(false);
      disposed = true;
      clearTimeout(timer);
    },
  };
}
