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
export function createRadioMeter() {
  let value = empty(),
    active = false,
    disposed = false,
    timer,
    version = 0;
  let context,
    analyser,
    source,
    wave,
    frequencies,
    queue = Promise.resolve();
  function reset() {
    value = empty();
  }
  function poll(token) {
    if (!active || disposed || token !== version) return;
    native('radio_audio_levels')
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
        .then(() => native('set_radio_meter', { enabled: active }))
        .then(() => {
          if (active && !disposed && token === version) poll(token);
        })
        .catch(() => {});
    }
  }
  return {
    attach(audio) {
      if (isDesktop) return;
      try {
        audio.crossOrigin = 'anonymous';
        context ??= new (window.AudioContext || window.webkitAudioContext)();
        analyser ??= context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.55;
        wave ??= new Float32Array(analyser.fftSize);
        frequencies ??= new Uint8Array(analyser.frequencyBinCount);
        source?.disconnect();
        source = context.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.disconnect();
        analyser.connect(context.destination);
        context.resume().catch(() => {});
      } catch {
        reset();
      }
    },
    setActive,
    sample() {
      if (!active) return value;
      if (!isDesktop && analyser && context.state === 'running') {
        analyser.getFloatTimeDomainData(wave);
        analyser.getByteFrequencyData(frequencies);
        const rms = Math.sqrt(wave.reduce((sum, n) => sum + n * n, 0) / wave.length);
        const bands = value.bands;
        for (let i = 0; i < 24; i++) {
          const lo = Math.max(
            1,
            Math.floor(((40 * Math.pow(180, i / 24)) / context.sampleRate) * analyser.fftSize)
          );
          const hi = Math.min(
            frequencies.length,
            Math.max(
              lo + 1,
              Math.ceil(
                ((40 * Math.pow(180, (i + 1) / 24)) / context.sampleRate) * analyser.fftSize
              )
            )
          );
          let sum = 0;
          for (let k = lo; k < hi; k++) sum += frequencies[k] || 0;
          bands[i] = rms > 0.000001 ? sum / Math.max(1, hi - lo) / 255 : 0;
        }
        const waveform = value.waveform;
        const block = wave.length / 64;
        for (let i = 0; i < 64; i++) {
          let peak = 0;
          for (let j = i * block; j < (i + 1) * block; j++)
            if (Math.abs(wave[j]) > Math.abs(peak)) peak = wave[j];
          waveform[i] =
            rms > 0.000001 ? Math.max(-1, Math.min(1, peak / Math.max(0.001, rms * 2.2))) : 0;
        }
        const average = (start, end) =>
          bands.slice(start, end).reduce((s, n) => s + n, 0) / (end - start);
        value = {
          available: true,
          rms,
          energy: Math.min(1, Math.sqrt(rms * 5)),
          bass: average(0, 7),
          mid: average(7, 16),
          high: average(16, 24),
          bands,
          waveform,
        };
      }
      return value;
    },
    dispose() {
      setActive(false);
      disposed = true;
      clearTimeout(timer);
      source?.disconnect();
      analyser?.disconnect();
      context?.close().catch(() => {});
    },
  };
}
