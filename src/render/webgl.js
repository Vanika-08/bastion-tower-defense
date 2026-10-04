// webgl.js
// Draws every moving thing (towers, enemies, bars, shots, effects) in ONE
// instanced draw call. Each instance is 28 bytes:
//   x, y, size, rotation, shape, extra (6 floats) + rgba color (4 bytes)
// Shapes are drawn in the fragment shader with signed distance functions,
// so there are no textures to load.

import { TOWERS, ENEMIES, rgba } from '../config.js';

const VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec2 a_pos;
layout(location=2) in float a_size;
layout(location=3) in float a_rot;
layout(location=4) in float a_shape;
layout(location=5) in float a_extra;
layout(location=6) in vec4 a_color;
uniform vec2 u_cam;
uniform float u_zoom;
uniform vec2 u_view;
out vec2 v_p;
out vec4 v_color;
flat out int v_shape;
out float v_extra;
void main() {
  int sh = int(a_shape + 0.5);
  vec2 scale = vec2(a_size);
  if (sh == 5) scale.y = a_size * 0.2;   // health bar
  if (sh == 8) scale.y = a_size * 0.3;   // barrel / streak
  vec2 local = a_corner * scale;
  float c = cos(a_rot), s = sin(a_rot);
  vec2 w = a_pos + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 sp = (w - u_cam) * u_zoom;
  vec2 clip = sp / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_p = a_corner;
  v_color = a_color;
  v_shape = sh;
  v_extra = a_extra;
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 v_p;
in vec4 v_color;
flat in int v_shape;
in float v_extra;
out vec4 o;

float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

float sdHex(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = v_p;
  vec4 col = v_color;

  if (v_shape == 5) {
    // health bar: green to red fill, dark background
    float f = p.x * 0.5 + 0.5;
    vec3 fill = mix(vec3(0.95, 0.25, 0.2), vec3(0.35, 0.95, 0.45), v_extra);
    o = f <= v_extra ? vec4(fill, 1.0) : vec4(0.05, 0.07, 0.06, 0.75);
    return;
  }
  if (v_shape == 7) {
    // soft glow
    float g = max(0.0, 1.0 - length(p));
    o = vec4(col.rgb, col.a * g * g);
    if (o.a < 0.01) discard;
    return;
  }

  float d;
  if (v_shape == 0) d = length(p) - 0.9;
  else if (v_shape == 1) d = sdBox(p, vec2(0.82), 0.22);
  else if (v_shape == 2) d = sdTri(p.yx, 0.62);
  else if (v_shape == 3) d = (abs(p.x) + abs(p.y) - 0.9) * 0.7071;
  else if (v_shape == 4) d = sdHex(p, 0.8);
  else if (v_shape == 6) d = abs(length(p) - 0.82) - 0.1;
  else d = sdBox(p, vec2(0.95), 0.4);

  float aa = fwidth(d) * 1.2;
  float a = 1.0 - smoothstep(-aa, aa, d);
  if (a < 0.01) discard;

  vec3 rgb = col.rgb;
  if (v_shape <= 4) {
    // dark rim + hit flash
    float rim = smoothstep(-0.26, -0.1, d);
    rgb = mix(rgb, rgb * 0.32, rim);
    rgb = mix(rgb, vec3(1.0), clamp(v_extra, 0.0, 1.0) * 0.8);
  }
  o = vec4(rgb, col.a * a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

const STRIDE = 7; // 7 x 4 bytes
const CAPACITY = 60000;

export class GLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.ok = !!gl;
    if (!gl) return;
    this.gl = gl;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.uCam = gl.getUniformLocation(prog, 'u_cam');
    this.uZoom = gl.getUniformLocation(prog, 'u_zoom');
    this.uView = gl.getUniformLocation(prog, 'u_view');

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    // one quad shared by all instances
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // instance data, allocated once
    this.buf = new ArrayBuffer(CAPACITY * STRIDE * 4);
    this.f32 = new Float32Array(this.buf);
    this.u32 = new Uint32Array(this.buf);
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ARRAY_BUFFER, this.buf.byteLength, gl.DYNAMIC_DRAW);
    const B = STRIDE * 4;
    const attr = (loc, size, type, norm, off) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, norm, B, off);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(1, 2, gl.FLOAT, false, 0);
    attr(2, 1, gl.FLOAT, false, 8);
    attr(3, 1, gl.FLOAT, false, 12);
    attr(4, 1, gl.FLOAT, false, 16);
    attr(5, 1, gl.FLOAT, false, 20);
    attr(6, 4, gl.UNSIGNED_BYTE, true, 24);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    // result in the framebuffer is premultiplied, which the page compositor expects
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.n = 0;
    this.lastCount = 0;

    // colors computed once
    this.towerCol = TOWERS.map((t) => rgba(t.color[0], t.color[1], t.color[2]));
    this.enemyCol = ENEMIES.map((e) => rgba(e.color[0], e.color[1], e.color[2]));
    this.enemySlowCol = ENEMIES.map((e) => rgba((e.color[0] * 0.5 + 90) | 0, (e.color[1] * 0.5 + 115) | 0, (e.color[2] * 0.4 + 150) | 0));
    this.baseCol = rgba(28, 44, 40);
    this.baseRim = rgba(70, 92, 80);
    this.pipCol = rgba(255, 214, 110);
    this.shotCol = [rgba(150, 240, 255), rgba(60, 45, 35), rgba(200, 235, 255), rgba(235, 215, 255)];
    this.glowCol = [rgba(77, 225, 255, 150), rgba(255, 150, 60, 170), rgba(150, 210, 255, 150), rgba(200, 140, 255, 170)];
  }

  resize(w, h, dpr) {
    if (!this.ok) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  push(x, y, size, rot, shape, extra, color) {
    if (this.n >= CAPACITY) return;
    const o = this.n * STRIDE;
    const f = this.f32;
    f[o] = x; f[o + 1] = y; f[o + 2] = size; f[o + 3] = rot; f[o + 4] = shape; f[o + 5] = extra;
    this.u32[o + 6] = color;
    this.n++;
  }

  render(game, cam, alpha, cull) {
    const gl = this.gl;
    this.n = 0;
    // visible area (plus a margin so things do not pop at the edge)
    const m = 30;
    const L = cull ? cam.left() - m : -1e9, R = cull ? cam.right() + m : 1e9;
    const Tp = cull ? cam.top() - m : -1e9, Bt = cull ? cam.bottom() + m : 1e9;

    // towers
    const T = game.T;
    for (let t = 0; t < T.hi; t++) {
      if (!T.alive[t]) continue;
      const x = T.x[t], y = T.y[t];
      if (x < L || x > R || y < Tp || y > Bt) continue;
      const type = T.type[t], lvl = T.level[t];
      const col = this.towerCol[type];
      this.push(x, y, 15, 0, 1, 0, this.baseRim);
      this.push(x, y, 13, 0, 1, 0, this.baseCol);
      const a = T.angle[t];
      const kick = T.recoil[t] > 0 ? -3 : 0;
      const len = type === 3 ? 12 : type === 1 ? 9 : 10;
      const bx = x + Math.cos(a) * (len * 0.8 + kick), by = y + Math.sin(a) * (len * 0.8 + kick);
      this.push(bx, by, len, a, 8, 0, col);
      this.push(x, y, type === 1 ? 9 : 8, type === 2 ? a : 0, type === 2 ? 3 : 0, 0, col);
      for (let k = 0; k < lvl; k++) this.push(x - 9 + k * 6, y + 11, 2.2, 0, 0, 0, this.pipCol);
    }

    // enemies
    const E = game.E;
    const ia = alpha, ib = 1 - alpha;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      const x = E.px[i] * ib + E.x[i] * ia;
      const y = E.py[i] * ib + E.y[i] * ia;
      if (x < L || x > R || y < Tp || y > Bt) continue;
      const type = E.type[i];
      const col = E.slowT[i] > 0 ? this.enemySlowCol[type] : this.enemyCol[type];
      this.push(x, y, E.radius[i] * 1.15, E.heading[i], ENEMIES[type].shape, E.flash[i] > 0 ? 1 : 0, col);
    }
    // health bars on top of all enemies
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.hp[i] >= E.maxHp[i]) continue;
      const x = E.px[i] * ib + E.x[i] * ia;
      const y = E.py[i] * ib + E.y[i] * ia;
      if (x < L || x > R || y < Tp || y > Bt) continue;
      const r = E.radius[i];
      this.push(x, y - r - 5, Math.max(7, r), 0, 5, E.hp[i] / E.maxHp[i], 0);
    }

    // projectiles
    const P = game.P;
    for (let p = 0; p < P.hi; p++) {
      if (!P.alive[p]) continue;
      const x = P.px[p] * ib + P.x[p] * ia;
      const y = P.py[p] * ib + P.y[p] * ia;
      if (x < L || x > R || y < Tp || y > Bt) continue;
      const k = P.kind[p];
      this.push(x, y, k === 1 ? 11 : 7, 0, 7, 0, this.glowCol[k]);
      if (k === 0) this.push(x, y, 2.6, 0, 0, 0, this.shotCol[0]);
      else if (k === 1) this.push(x, y, 4.6, 0, 0, 0, this.shotCol[1]);
      else if (k === 2) this.push(x, y, 4, P.angle[p], 3, 0, this.shotCol[2]);
      else this.push(x, y, 9, P.angle[p], 8, 0, this.shotCol[3]);
    }

    // effects
    const F = game.F;
    for (let i = 0; i < F.hi; i++) {
      if (!F.alive[i]) continue;
      const x = F.x[i], y = F.y[i];
      if (x < L || x > R || y < Tp || y > Bt) continue;
      const t = F.life[i] / F.max[i];
      const a = (((F.color[i] >>> 24) * t) | 0) << 24;
      const col = ((F.color[i] & 0x00ffffff) | a) >>> 0;
      if (F.kind[i] === 1) this.push(x, y, F.size[i] * (1.1 - t * 0.6), 0, 6, 0, col);
      else this.push(x, y, F.size[i] * (0.4 + t * 0.6), 0, 0, 0, col);
    }

    // upload only the used part and draw everything at once
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.n > 0) {
      gl.useProgram(this.prog);
      gl.uniform2f(this.uCam, cam.x, cam.y);
      gl.uniform1f(this.uZoom, cam.zoom);
      gl.uniform2f(this.uView, cam.viewW, cam.viewH);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.f32, 0, this.n * STRIDE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
      gl.bindVertexArray(null);
    }
    this.lastCount = this.n;
    return this.n;
  }

  clear() {
    if (!this.ok) return;
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }
}
