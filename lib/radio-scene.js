// A small, self-contained WebGL sculpture. Animation is ambient, not an audio analyser.
const palettes = {
  mellow: [
    [0.8, 0.91, 0.87],
    [0.93, 0.64, 0.36],
  ],
  serenity: [
    [0.44, 0.76, 1.0],
    [0.45, 0.87, 0.79],
  ],
  main: [
    [0.95, 0.59, 0.43],
    [0.72, 0.49, 0.91],
  ],
};
const vertex = `
attribute vec3 position;
attribute vec3 normal;
uniform mat4 model;
uniform float aspect;
uniform float narrow;
uniform vec2 viewCenter;
uniform float projectionScale;
varying vec3 P;
varying vec3 N;
void main() {
  vec4 p = model * vec4(position, 1.0);
  P = p.xyz;
  N = mat3(model) * normal;
  float z = 4.7 - p.z;
  float scale = projectionScale;
  vec2 center = viewCenter;
  gl_Position = vec4(p.x * scale / aspect + center.x * z,
                     p.y * scale + center.y * z, z * 0.9 - 0.3, z);
}`;
const fragment = `
precision highp float;
varying vec3 P;
varying vec3 N;
uniform vec3 cool;
uniform vec3 warm;
uniform float time;
uniform float detail;
vec3 environment(vec3 r) {
  vec3 c = mix(vec3(0.018, 0.026, 0.031), cool * 0.32, smoothstep(-0.6, 0.9, r.y));
  // Reflections of long photographic softboxes and a warm overhead light.
  float strip = pow(max(0.0, 1.0 - abs(dot(r, normalize(vec3(0.55, 0.2, 0.81))))), 26.0);
  c += vec3(1.0, 0.97, 0.86) * strip * 3.2;
  float key = pow(max(dot(r, normalize(vec3(-0.6, 0.85, 0.4))), 0.0), 8.0);
  c += warm * key * 4.0;
  c += cool * pow(max(dot(r, normalize(vec3(0.5, -0.4, 0.7))), 0.0), 12.0) * 1.35;
  float line = exp(-abs(r.y + r.x * 0.35 - 0.13) * 80.0);
  c += vec3(0.8, 0.95, 1.0) * line * 0.9;
  return c;
}
void main() {
  vec3 n = normalize(N);
  vec3 v = normalize(vec3(0.0, 0.0, 4.7) - P);
  float facing = max(dot(n, v), 0.0);
  float fresnel = pow(1.0 - facing, 3.0);
  vec3 r = reflect(-v, n);
  vec3 reflected = environment(r);
  vec3 film = 0.5 + 0.5 * cos(9.0 * facing + P.y * 2.3 + vec3(0.0, 1.4, 3.0));
  vec3 iridescence = mix(cool, warm, 0.5 + 0.5 * sin(facing * 6.0 + P.y * 1.8));
  vec3 c = reflected * mix(vec3(0.55), iridescence, 0.35);
  c += film * 0.04 + cool * 0.055;
  c += iridescence * fresnel * 0.55;
  float diffuse = max(dot(n, normalize(vec3(-0.5, 0.9, 1.2))), 0.0);
  c += cool * diffuse * 0.10;
  if (detail > 0.5) c = warm * (0.5 + reflected * 0.9) + fresnel * 0.5;
  c *= 0.86 + 0.14 * smoothstep(-1.5, 0.7, P.y);
  c = c / (c + vec3(0.7));
  c = pow(c, vec3(0.82));
  gl_FragColor = vec4(c, 1.0);
}`;
const backgroundVertex = `
attribute vec2 position;
varying vec2 uv;
void main() { uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.99, 1.0); }
`;
const backgroundFragment = `
precision highp float;
varying vec2 uv;
uniform float aspect;
uniform float narrow;
uniform vec2 viewCenter;
uniform float projectionScale;
uniform vec3 cool;
uniform vec3 warm;
uniform float time;
uniform float energy;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))) * 43758.5453); }
void main() {
  vec2 center = viewCenter * 0.5 + 0.5;
  vec2 p = (uv-center)*vec2(aspect,1.0);
  float halo = exp(-dot(p,p)*8.0*pow(2.25/projectionScale,2.0));
  vec3 c = vec3(0.018,0.027,0.034) + cool * halo * 0.045;
  c += warm * exp(-dot(p-vec2(-0.22,0.2),p-vec2(-0.22,0.2))*18.0)*0.013;
  // An elliptical pool of reflected light anchors the floating object.
  vec2 floorP = (uv - (center + vec2(0.0,-projectionScale*0.137))) * vec2(aspect,5.5) * (2.25/projectionScale);
  float floorD = length(floorP);
  c += cool * exp(-floorD * floorD * 12.0) * 0.045;
  c += warm * exp(-pow((floorD-0.22)*22.0,2.0)) * 0.035;
  c += (hash(gl_FragCoord.xy)-0.5)/420.0;
  gl_FragColor = vec4(c,1.0);
}`;
const particleVertex = `
attribute vec3 position;
uniform float aspect;
uniform float narrow;
uniform vec2 viewCenter;
uniform float projectionScale;
uniform float time;
uniform float pixelRatio;
varying float brightness;
void main() {
  float a = time * 0.018;
  vec3 p = vec3(position.x*cos(a)-position.z*sin(a), position.y+sin(time*0.1+position.x)*0.06, position.x*sin(a)+position.z*cos(a));
  float z = 4.7 - p.z;
  float scale = projectionScale;
  vec2 center = viewCenter;
  gl_Position = vec4(p.x*scale/aspect+center.x*z,p.y*scale+center.y*z,z*0.9-0.3,z);
  gl_PointSize = (1.8 + 3.0*fract(position.x*43.7)) * pixelRatio * 4.0/z;
  brightness = (0.28+0.24*sin(time*0.4+position.x*8.0)) * (0.7+0.3*p.z);
}`;
const particleFragment = `
precision mediump float;
uniform vec3 cool;
uniform vec3 warm;
varying float brightness;
void main() {
  float d=length(gl_PointCoord-vec2(0.5))*2.0;
  float alpha=exp(-d*d*5.0)*brightness;
  gl_FragColor=vec4(mix(cool,warm,gl_PointCoord.y),alpha);
}`;
function program(gl, vs, fs) {
  function shader(type, source) {
    const item = gl.createShader(type);
    gl.shaderSource(item, source);
    gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) {
      const reason = gl.getShaderInfoLog(item);
      gl.deleteShader(item);
      throw new Error(reason);
    }
    return item;
  }
  const vert = shader(gl.VERTEX_SHADER, vs);
  let frag;
  let result;
  try {
    frag = shader(gl.FRAGMENT_SHADER, fs);
    result = gl.createProgram();
    gl.attachShader(result, vert);
    gl.attachShader(result, frag);
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(result));
    return result;
  } catch (error) {
    if (result) gl.deleteProgram(result);
    throw error;
  } finally {
    gl.deleteShader(vert);
    if (frag) gl.deleteShader(frag);
  }
}
function torus(gl, radius, tube, twist) {
  const vertices = [],
    normals = [],
    indices = [];
  const U = 240,
    V = 48;
  function point(u, v) {
    if (!twist)
      return [
        (radius + Math.cos(v) * tube) * Math.cos(u),
        (radius + Math.cos(v) * tube) * Math.sin(u),
        Math.sin(v) * tube,
      ];
    // A continuous trefoil swept with a round section; geometry, not a flat sprite.
    const center = (angle) => {
      const r = 0.78 + 0.27 * Math.cos(3 * angle);
      return [r * Math.cos(2 * angle), r * Math.sin(2 * angle), 0.4 * Math.sin(3 * angle)];
    };
    const c = center(u),
      next = center(u + 0.0001);
    const t = next.map((x, k) => x - c[k]);
    const length = Math.hypot(...t);
    for (let k = 0; k < 3; k++) t[k] /= length;
    const nLength = Math.hypot(t[1], t[0]);
    const n = [t[1] / nLength, -t[0] / nLength, 0];
    const b = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
    const r = tube * (0.85 + 0.12 * Math.cos(3 * u));
    return c.map((x, k) => x + r * (n[k] * Math.cos(v) + b[k] * Math.sin(v)));
  }
  for (let i = 0; i <= U; i++) {
    for (let j = 0; j <= V; j++) {
      const u = (i / U) * Math.PI * 2,
        v = (j / V) * Math.PI * 2;
      const p = point(u, v),
        pu = point(u + 0.001, v),
        pv = point(u, v + 0.001);
      const a = pu.map((x, k) => x - p[k]),
        b = pv.map((x, k) => x - p[k]);
      const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const length = Math.hypot(...n);
      vertices.push(...p);
      normals.push(...n.map((x) => (twist ? -x : x) / length));
      if (i < U && j < V) {
        const k = i * (V + 1) + j;
        indices.push(k, k + 1, k + V + 1, k + 1, k + V + 2, k + V + 1);
      }
    }
  }
  function buffer(target, data) {
    const item = gl.createBuffer();
    gl.bindBuffer(target, item);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return item;
  }
  return {
    positions: buffer(gl.ARRAY_BUFFER, new Float32Array(vertices)),
    normals: buffer(gl.ARRAY_BUFFER, new Float32Array(normals)),
    indices: buffer(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices)),
    count: indices.length,
  };
}
function rotation(x, y, z, scale = 1) {
  const cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z);
  return new Float32Array([
    cy * cz * scale,
    (sx * sy * cz + cx * sz) * scale,
    (-cx * sy * cz + sx * sz) * scale,
    0,
    -cy * sz * scale,
    (-sx * sy * sz + cx * cz) * scale,
    (cx * sy * sz + sx * cz) * scale,
    0,
    sy * scale,
    -sx * cy * scale,
    cx * cy * scale,
    0,
    0,
    0,
    0,
    1,
  ]);
}
function renderer(canvas) {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: true,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL unavailable');
  const programs = [];
  const meshes = [];
  let quad, particles;
  try {
    const sculpture = program(gl, vertex, fragment);
    programs.push(sculpture);
    const background = program(gl, backgroundVertex, backgroundFragment);
    programs.push(background);
    const points = program(gl, particleVertex, particleFragment);
    programs.push(points);
    const dust = [];
    for (let i = 0; i < 180; i++) {
      const a = i * 2.399963,
        r = 1.5 + 0.8 * Math.sin(i * 17.31) ** 2;
      dust.push(Math.cos(a) * r, Math.sin(a) * r * 0.7, Math.sin(i * 7.12) * 0.9);
    }
    particles = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, particles);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dust), gl.STATIC_DRAW);
    meshes.push(torus(gl, 1.02, 0.235, true));
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    const uniforms = programs.map((p) =>
      Object.fromEntries(
        [
          'model',
          'aspect',
          'narrow',
          'cool',
          'warm',
          'time',
          'detail',
          'energy',
          'pixelRatio',
          'viewCenter',
          'projectionScale',
        ].map((k) => [k, gl.getUniformLocation(p, k)])
      )
    );
    const attributes = programs.map((p) => ({
      position: gl.getAttribLocation(p, 'position'),
      normal: gl.getAttribLocation(p, 'normal'),
    }));
    let width = 0,
      height = 0;
    function attribute(index, buffer, size) {
      if (index < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, 0, 0);
    }
    return {
      draw({ time, energy, palette, pointer, quality }) {
        const rect = canvas.getBoundingClientRect();
        const ratio = Math.min(window.devicePixelRatio || 1, 1.5) * quality;
        const maxRatio = Math.sqrt(1500000 / Math.max(1, rect.width * rect.height));
        const w = Math.max(1, Math.round(rect.width * Math.min(ratio, maxRatio)));
        const h = Math.max(1, Math.round(rect.height * Math.min(ratio, maxRatio)));
        if (w !== width || h !== height) {
          canvas.width = width = w;
          canvas.height = height = h;
          gl.viewport(0, 0, w, h);
        }
        const aspect = rect.width / Math.max(1, rect.height),
          narrow = rect.width <= 740 ? 1 : 0;
        const panel = canvas.closest('.music-panel');
        const composition = panel.querySelector('.music-composition').getBoundingClientRect();
        const editorial = panel.querySelector('.music-editorial').getBoundingClientRect();
        const top = narrow ? editorial.bottom - rect.top + 12 : composition.top - rect.top + 8;
        const bottom = composition.bottom - rect.top - (narrow ? 34 : 24);
        const diameter = Math.max(
          60,
          Math.min(rect.width * (narrow ? 0.86 : 0.48), Math.max(60, bottom - top) * 0.94)
        );
        const center = [narrow ? 0 : 0.32, 1 - (top + bottom) / rect.height];
        const scale = (diameter / rect.height) * 3.55;
        for (let i = 0; i < programs.length; i++) {
          gl.useProgram(programs[i]);
          gl.uniform2fv(uniforms[i].viewCenter, center);
          gl.uniform1f(uniforms[i].projectionScale, scale);
        }
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.useProgram(background);
        attribute(attributes[1].position, quad, 2);
        if (attributes[1].normal >= 0) gl.disableVertexAttribArray(attributes[1].normal);
        gl.uniform1f(uniforms[1].aspect, aspect);
        gl.uniform1f(uniforms[1].narrow, narrow);
        gl.uniform3fv(uniforms[1].cool, palette[0]);
        gl.uniform3fv(uniforms[1].warm, palette[1]);
        gl.uniform1f(uniforms[1].time, time);
        gl.uniform1f(uniforms[1].energy, energy);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.useProgram(sculpture);
        const u = uniforms[0];
        gl.uniform1f(u.aspect, aspect);
        gl.uniform1f(u.narrow, narrow);
        gl.uniform1f(u.time, time);
        gl.uniform3fv(u.cool, palette[0]);
        gl.uniform3fv(u.warm, palette[1]);
        const tiltX = 0.3 + Math.sin(time * 0.12) * 0.13 + pointer[1] * 0.09;
        const tiltY = -0.36 + Math.sin(time * 0.1) * 0.22 + pointer[0] * 0.12;
        for (let i = 0; i < meshes.length; i++) {
          const mesh = meshes[i];
          attribute(attributes[0].position, mesh.positions, 3);
          attribute(attributes[0].normal, mesh.normals, 3);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
          gl.uniformMatrix4fv(
            u.model,
            false,
            rotation(
              tiltX + (i ? 1.05 : 0),
              tiltY + (i ? 0.5 : 0),
              -0.4 + time * 0.022 * (i ? -1 : 1),
              1 + energy * 0.015
            )
          );
          gl.uniform1f(u.detail, i);
          gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
        }
        gl.useProgram(points);
        const p = uniforms[2];
        attribute(attributes[2].position, particles, 3);
        if (attributes[0].normal !== attributes[2].position)
          gl.disableVertexAttribArray(attributes[0].normal);
        gl.uniform1f(p.aspect, aspect);
        gl.uniform1f(p.narrow, narrow);
        gl.uniform1f(p.time, time);
        gl.uniform1f(p.pixelRatio, width / Math.max(1, rect.width));
        gl.uniform3fv(p.cool, palette[0]);
        gl.uniform3fv(p.warm, palette[1]);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.depthMask(false);
        gl.drawArrays(gl.POINTS, 0, 180);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      },
      dispose() {
        for (const p of programs) gl.deleteProgram(p);
        for (const m of meshes)
          for (const k of ['positions', 'normals', 'indices']) gl.deleteBuffer(m[k]);
        gl.deleteBuffer(quad);
        gl.deleteBuffer(particles);
      },
    };
  } catch (error) {
    for (const p of programs) gl.deleteProgram(p);
    for (const m of meshes)
      for (const k of ['positions', 'normals', 'indices']) gl.deleteBuffer(m[k]);
    if (quad) gl.deleteBuffer(quad);
    if (particles) gl.deleteBuffer(particles);
    throw error;
  }
}
export function createRadioScene(panel) {
  const canvas = panel.querySelector('canvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const motionButton = panel.querySelector('#music-motion');
  let drawing = null,
    failed = false,
    open = false,
    playing = false,
    paused = false,
    disposed = false;
  let frame = 0,
    last = 0,
    time = 6,
    energy = 0,
    quality = 1,
    slowFrames = 0;
  let station = 'mellow',
    palette = palettes.mellow.map((v) => [...v]);
  let pointer = [0, 0],
    targetPointer = [0, 0];
  function cancel() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    panel.dataset.animating = 'false';
  }
  function paint(now = 0) {
    frame = 0;
    if (!open || disposed || document.hidden || failed) return;
    if (!drawing) {
      try {
        drawing = renderer(canvas);
        panel.dataset.renderer = 'webgl';
      } catch {
        failed = true;
        panel.dataset.renderer = 'poster';
        updateButton();
        return;
      }
    }
    const animate = !paused;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    if (animate && dt > 0 && dt < 0.03) {
      frame = requestAnimationFrame(paint);
      return;
    }
    if (dt > 0.05) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 45 && quality > 0.6) {
      quality = Math.max(0.6, quality - 0.2);
      slowFrames = 0;
    }
    last = now;
    if (animate) time += dt * (playing ? 1 : 0.28);
    const smoothing = animate ? 1 - Math.exp(-Math.max(dt, 0.03) * 3) : 1;
    energy += (Number(playing) - energy) * smoothing;
    palette = palette.map((v, i) => v.map((x, j) => x + (palettes[station][i][j] - x) * smoothing));
    pointer = pointer.map((x, i) => x + (targetPointer[i] - x) * smoothing);
    try {
      drawing.draw({ time, energy, palette, pointer, quality });
    } catch {
      drawing.dispose();
      drawing = null;
      failed = true;
      panel.dataset.renderer = 'poster';
      updateButton();
      return;
    }
    panel.dataset.animating = String(animate);
    panel.dataset.frames = String(Number(panel.dataset.frames || 0) + 1);
    if (animate) frame = requestAnimationFrame(paint);
  }
  function schedule() {
    cancel();
    if (open && !document.hidden && !disposed) paint(performance.now());
  }
  function preferenceChanged() {
    paused = reduced.matches;
    updateButton();
    schedule();
  }
  function updateButton() {
    motionButton.disabled = failed;
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.setAttribute('aria-label', paused ? '开启动效' : '暂停画面动效');
    if (failed) motionButton.setAttribute('aria-label', '静态画面');
    motionButton.title = motionButton.getAttribute('aria-label');
    motionButton.querySelector('use').setAttribute('href', paused ? '#icon-play' : '#icon-pause');
  }
  function visibility() {
    schedule();
  }
  function lost(event) {
    event.preventDefault();
    cancel();
    drawing = null;
    failed = true;
    panel.dataset.renderer = 'poster';
    updateButton();
  }
  function restored() {
    failed = false;
    updateButton();
    schedule();
  }
  function move(event) {
    if (paused) return;
    const r = panel.getBoundingClientRect();
    targetPointer = [
      (event.clientX - r.left) / r.width - 0.5,
      (event.clientY - r.top) / r.height - 0.5,
    ];
  }
  function leave() {
    targetPointer = [0, 0];
  }
  function toggleMotion() {
    paused = !paused;
    updateButton();
    schedule();
  }
  motionButton.addEventListener('click', toggleMotion);
  panel.addEventListener('pointermove', move, { passive: true });
  panel.addEventListener('pointerleave', leave);
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  const resizeObserver = new ResizeObserver(() => {
    if (open && paused) schedule();
  });
  resizeObserver.observe(panel);
  document.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', preferenceChanged);
  paused = reduced.matches;
  updateButton();
  return {
    update(value) {
      station = value.station;
      playing = value.state === 'playing';
      panel.dataset.station = station;
      if (open && paused) schedule();
    },
    setOpen(value) {
      open = value;
      schedule();
    },
    dispose() {
      disposed = true;
      cancel();
      drawing?.dispose();
      drawing = null;
      motionButton.removeEventListener('click', toggleMotion);
      panel.removeEventListener('pointermove', move);
      panel.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      reduced.removeEventListener('change', preferenceChanged);
    },
  };
}
