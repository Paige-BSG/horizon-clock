// Draw the measured time-domain waveform. No playback means a straight line.
const colors = {
  mellow: ['#bdebd9', '#e9c38f'],
  serenity: ['#91d8f2', '#c3b0ed'],
  main: ['#efb99b', '#df8cb9'],
};
const still = {
  available: false,
  rms: 0,
  energy: 0,
  bass: 0,
  mid: 0,
  high: 0,
  waveform: new Float32Array(64),
};
export function createRadioScene(panel, meter) {
  const canvas = panel.querySelector('canvas'),
    ctx = canvas.getContext('2d', { alpha: true });
  const button = document.getElementById('music-motion'),
    reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let open = false,
    playing = false,
    muted = false,
    paused = reduced.matches,
    disposed = false,
    frame = 0,
    next = 0,
    last = 0,
    station = 'mellow',
    energy = 0;
  const shape = new Float32Array(64);
  let unavailableAt = 0,
    width = 0,
    height = 0,
    ratio = 1;
  if (!ctx) {
    panel.dataset.renderer = 'none';
    button.disabled = true;
    return {
      update(value) {
        panel.dataset.station = value.station;
      },
      setOpen() {},
      dispose() {
        meter.setActive(false);
      },
    };
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    ratio = Math.min(devicePixelRatio || 1, 1.6);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
  }
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    next = 0;
    last = 0;
    panel.dataset.animating = 'false';
    meter.setActive(false);
  }
  function paint(now = performance.now()) {
    frame = 0;
    if (!open || disposed || document.hidden || !ctx) return;
    const animate = !paused && playing && !muted;
    if (animate && next && now < next) {
      frame = requestAnimationFrame(paint);
      return;
    }
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    next = next && now - next < 100 ? next + 1000 / 30 : now + 1000 / 30;
    last = now;
    const sample = playing && animate && !muted ? meter.sample() : still;
    const target = sample.available ? sample.energy : 0;
    if (!playing || muted) {
      energy = 0;
      shape.fill(0);
    } else if (animate) {
      energy += (target - energy) * Math.min(1, (target > energy ? 14 : 5) * Math.max(dt, 0.033));
      for (let i = 0; i < shape.length; i++) {
        const targetPoint = sample.available ? sample.waveform[i] || 0 : 0;
        shape[i] += (targetPoint - shape[i]) * 0.55;
      }
    }
    if (playing && animate && !muted && !sample.available) {
      unavailableAt ||= now;
    } else unavailableAt = 0;
    panel.querySelector('#music-analysis').hidden = !(unavailableAt && now - unavailableAt > 2500);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const cy = height * 0.5,
      left = 5,
      right = Math.max(6, width - 5);
    const magnitude = Math.max(...shape.map(Math.abs));
    const amplitude = height * 0.3 * (0.35 + energy * 0.65);
    const gradient = ctx.createLinearGradient(left, 0, right, 0);
    gradient.addColorStop(0, colors[station][0] + '60');
    gradient.addColorStop(0.28, colors[station][0]);
    gradient.addColorStop(0.68, '#eaf6f0');
    gradient.addColorStop(1, colors[station][1] + '70');
    function trace(scale = 1) {
      ctx.beginPath();
      ctx.moveTo(left, cy);
      for (let i = 0; i < shape.length; i++) {
        const x = left + ((right - left) * (i + 1)) / (shape.length + 1);
        const taper = Math.sin((Math.PI * (i + 1)) / (shape.length + 1));
        const y = cy - shape[i] * amplitude * taper * scale;
        const previousX = left + ((right - left) * i) / (shape.length + 1);
        const previousY = i
          ? cy - shape[i - 1] * amplitude * Math.sin((Math.PI * i) / (shape.length + 1)) * scale
          : cy;
        ctx.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2);
      }
      ctx.lineTo(right, cy);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = gradient;
    if (magnitude > 0.0001) {
      ctx.globalAlpha = 0.14;
      ctx.lineWidth = 7;
      ctx.shadowColor = colors[station][0];
      ctx.shadowBlur = 16;
      trace();
      ctx.stroke();
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 0;
      trace(0.66);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.4;
    ctx.shadowBlur = magnitude > 0.0001 ? 7 : 2;
    ctx.shadowColor = colors[station][0];
    trace();
    ctx.stroke();
    ctx.shadowBlur = 0;
    panel.dataset.renderer = 'waveform';
    panel.dataset.wavePeak = String(magnitude);
    panel.dataset.energy = energy.toFixed(4);
    panel.dataset.audioRms = String(sample.rms || 0);
    panel.dataset.audioAvailable = String(sample.available);
    panel.dataset.animating = String(animate);
    panel.dataset.frames = String(Number(panel.dataset.frames || 0) + 1);
    if (animate) frame = requestAnimationFrame(paint);
  }
  function sync() {
    stop();
    meter.setActive(open && playing && !muted && !paused && !document.hidden);
    if (open && !disposed && !document.hidden) {
      resize();
      paint();
    }
  }
  function updateButton() {
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', paused ? '开启声纹动效' : '暂停声纹动效');
    button.title = button.getAttribute('aria-label');
    button.querySelector('span').textContent = paused ? '开启' : '暂停';
    button.querySelector('use').setAttribute('href', paused ? '#icon-play' : '#icon-pause');
  }
  function toggleMotion() {
    paused = !paused;
    updateButton();
    sync();
  }
  function preference() {
    paused = reduced.matches;
    updateButton();
    sync();
  }
  function visibility() {
    sync();
  }
  const observer = new ResizeObserver(() => {
    if (open) {
      resize();
      if (paused || !playing || muted) paint();
    }
  });
  observer.observe(canvas);
  button.addEventListener('click', toggleMotion);
  reduced.addEventListener('change', preference);
  document.addEventListener('visibilitychange', visibility);
  updateButton();
  return {
    update(value) {
      const changedStation = station !== value.station;
      station = value.station;
      panel.dataset.station = station;
      const nextPlaying = value.state === 'playing';
      const nextMuted = value.volume === 0;
      if (nextPlaying !== playing || nextMuted !== muted) {
        playing = nextPlaying;
        muted = nextMuted;
        sync();
      } else if (open && (paused || !playing || muted || changedStation)) paint();
    },
    setOpen(value) {
      open = value;
      sync();
    },
    dispose() {
      disposed = true;
      stop();
      observer.disconnect();
      button.removeEventListener('click', toggleMotion);
      reduced.removeEventListener('change', preference);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
