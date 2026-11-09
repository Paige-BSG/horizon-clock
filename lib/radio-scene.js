// Particle displacement and light intensity use measured audio, never a synthetic beat.
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
  bands: new Float32Array(24),
};
export function createRadioScene(panel, meter) {
  const canvas = panel.querySelector('canvas'),
    ctx = canvas.getContext('2d', { alpha: true });
  const button = panel.querySelector('#music-motion'),
    reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let open = false,
    playing = false,
    muted = false,
    paused = reduced.matches,
    disposed = false,
    frame = 0,
    next = 0,
    last = 0,
    time = 0,
    station = 'mellow',
    energy = 0,
    bass = 0;
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
  const particles = Array.from({ length: 1800 }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / 1800,
      a = i * 2.399963,
      r = Math.sqrt(1 - y * y);
    return {
      x: Math.cos(a) * r,
      y,
      z: Math.sin(a) * r,
      band: i % 24,
      phase: i * 0.71,
      size: 0.6 + (i % 5) * 0.19,
    };
  });
  const sprites = Object.fromEntries(
    Object.entries(colors).map(([key, palette]) => [
      key,
      palette.map((color) => {
        const c = document.createElement('canvas');
        c.width = c.height = 40;
        const g = c.getContext('2d');
        const gradient = g.createRadialGradient(20, 20, 0, 20, 20, 20);
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(0.13, color);
        gradient.addColorStop(0.4, color + '50');
        gradient.addColorStop(1, color + '00');
        g.fillStyle = gradient;
        g.fillRect(0, 0, 40, 40);
        return c;
      }),
    ])
  );
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
    const animate = !paused;
    if (animate && next && now < next) {
      frame = requestAnimationFrame(paint);
      return;
    }
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    next = next && now - next < 100 ? next + 1000 / 30 : now + 1000 / 30;
    last = now;
    if (animate && playing) time += dt;
    const sample = playing && animate && !muted ? meter.sample() : still;
    const target = sample.available ? sample.energy : 0,
      targetBass = sample.available ? sample.bass : 0;
    const smooth = (target > energy ? 14 : 5) * Math.max(dt, 0.033);
    energy += (target - energy) * Math.min(1, smooth);
    bass += (targetBass - bass) * Math.min(1, 12 * Math.max(dt, 0.033));
    if (playing && animate && !muted && !sample.available) {
      unavailableAt ||= now;
    } else unavailableAt = 0;
    panel.querySelector('#music-analysis').hidden = !(unavailableAt && now - unavailableAt > 2500);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const cx = width * 0.5,
      cy = height * 0.5,
      radius = Math.max(20, Math.min(width * 0.36, height * 0.35));
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.7);
    halo.addColorStop(0, colors[station][0] + '0b');
    halo.addColorStop(0.6, colors[station][0] + '05');
    halo.addColorStop(1, colors[station][0] + '00');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    const ay = 0.35 + time * 0.07,
      ax = -0.2 + Math.sin(time * 0.04) * 0.08,
      cos = Math.cos(ay),
      sin = Math.sin(ay),
      ca = Math.cos(ax),
      sa = Math.sin(ax);
    const points = [];
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i],
        x = p.x * cos + p.z * sin,
        z = -p.x * sin + p.z * cos,
        y = p.y * ca - z * sa,
        depth = p.y * sa + z * ca;
      const band = sample.available ? sample.bands[p.band] || 0 : 0;
      const ripple = 1 + energy * 0.12 + bass * 0.18 + band * 0.17 * Math.sin(p.phase + time * 1.2);
      const perspective = 2.9 / (2.9 - depth * 0.32),
        radial = radius * ripple * perspective;
      points.push({
        x: cx + x * radial,
        y: cy + y * radial,
        z: depth,
        size: p.size * perspective,
        alpha: (0.22 + (depth + 1) * 0.22) * (0.75 + energy * 0.7),
        index: i,
      });
    }
    points.sort((a, b) => a.z - b.z);
    for (const p of points) {
      const color = p.index % 7 === 0 ? 1 : 0;
      ctx.globalAlpha = Math.min(1, p.alpha);
      if (p.index % 5 === 0) {
        const size = (4 + p.size * 2) * (1 + energy * 0.5);
        ctx.drawImage(sprites[station][color], p.x - size / 2, p.y - size / 2, size, size);
      } else {
        ctx.fillStyle = colors[station][color];
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    panel.dataset.renderer = 'particles';
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
    button.setAttribute('aria-label', paused ? '开启粒子动效' : '暂停粒子动效');
    button.title = button.getAttribute('aria-label');
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
      if (paused) paint();
    }
  });
  observer.observe(canvas);
  button.addEventListener('click', toggleMotion);
  reduced.addEventListener('change', preference);
  document.addEventListener('visibilitychange', visibility);
  updateButton();
  return {
    update(value) {
      station = value.station;
      panel.dataset.station = station;
      const nextPlaying = value.state === 'playing';
      const nextMuted = value.volume === 0;
      if (nextPlaying !== playing || nextMuted !== muted) {
        playing = nextPlaying;
        muted = nextMuted;
        sync();
      } else if (open && paused) paint();
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
