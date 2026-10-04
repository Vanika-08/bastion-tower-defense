// main.js
// Wires everything together: one requestAnimationFrame loop for the whole
// game, a fixed timestep simulation, input handling and the 2D overlay.

import { TILE, COLS, ROWS, STEP, TOWERS, ENEMIES } from './config.js';
import { Game } from './sim.js';
import { Camera } from './camera.js';
import { GLRenderer } from './render/webgl.js';
import { drawNaive } from './render/canvas.js';
import { Background } from './render/background.js';
import { Perf } from './perf.js';
import { UI } from './ui.js';
import { buildWave, rewardMult } from './waves.js';

const $ = (id) => document.getElementById(id);

const game = new Game();
const cam = new Camera();
const perf = new Perf();
const bg = new Background($('bg'), game.map);
const glr = new GLRenderer($('gl'));
const ov = $('ov');
const octx = ov.getContext('2d');

const app = {
  game, cam, perf,
  speed: 1,
  paused: false,
  placing: -1,   // tower type being placed, -1 if none
  selected: -1,  // selected tower slot
  hoverC: -1,
  hoverR: -1,
  settings: { webgl: glr.ok, culling: true, hudThrottle: true },
  fpsCap: 0,
};
const ui = new UI(app);

if (!glr.ok) {
  const box = document.querySelector('[data-opt="webgl"]');
  box.checked = false;
  box.disabled = true;
  ui.toast('WebGL2 is not available, using the Canvas renderer');
}

// ---------- sizing ----------

let dpr = 1;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  bg.resize(w, h, dpr);
  glr.resize(w, h, dpr);
  ov.width = Math.round(w * dpr);
  ov.height = Math.round(h * dpr);
  cam.resize(w, h, 52, 84);
}
window.addEventListener('resize', resize);
resize();

// ---------- floating text (small fixed pool) ----------

const texts = [];
for (let i = 0; i < 60; i++) texts.push({ on: false, x: 0, y: 0, s: '', life: 0, color: '' });

function floatText(x, y, s, color) {
  for (const t of texts) {
    if (t.on) continue;
    t.on = true; t.x = x; t.y = y; t.s = s; t.life = 1; t.color = color;
    return;
  }
}

// ---------- game events ----------

game.listener = (type, x, y, v) => {
  switch (type) {
    case 'kill':
      if (game.state !== 'stress' && v !== 3) {
        const r = Math.round(ENEMIES[v].reward * rewardMult(game.wave));
        floatText(x, y - 10, `+${r}`, '#f3c662');
      }
      break;
    case 'leak':
      ui.flashLives();
      break;
    case 'wave': {
      const groups = buildWave(v);
      const boss = groups.some((g) => g.type === 4);
      ui.banner(`Wave ${v}`, boss ? 'A warlord approaches' : v === 1 ? 'Here they come' : '');
      break;
    }
    case 'cleared':
      ui.toast(`Wave ${game.wave} cleared, +${v} gold`);
      break;
    case 'early':
      ui.toast(`Called early, +${v} gold`);
      break;
    case 'upgrade':
      floatText(x, y - 18, `Level ${v + 1}`, '#9be8bd');
      break;
    case 'sell':
      floatText(x, y - 10, `+${v}`, '#f3c662');
      break;
    case 'won':
      app.placing = -1;
      ui.showEnd(true);
      break;
    case 'lost':
      app.placing = -1;
      ui.showEnd(false);
      break;
  }
};

// ---------- actions ----------

function pickTower(i) {
  if (game.state === 'won' || game.state === 'lost') return;
  app.placing = app.placing === i ? -1 : i;
  app.selected = -1;
  ov.classList.toggle('placing', app.placing >= 0);
  ui.updateHud(0, true);
}

function cancel() {
  app.placing = -1;
  app.selected = -1;
  ov.classList.remove('placing');
  ui.updateHud(0, true);
}

function clickTile(c, r) {
  if (app.placing >= 0) {
    const def = TOWERS[app.placing];
    if (!game.canPlace(c, r)) { ui.toast('You can only build on open grass'); return; }
    if (game.gold < def.cost) { ui.toast(`${def.name} costs ${def.cost} gold`); return; }
    game.placeTower(app.placing, c, r);
    // stay in build mode while we can still afford another one
    if (game.gold < def.cost) { app.placing = -1; ov.classList.remove('placing'); }
    ui.updateHud(0, true);
    return;
  }
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) { app.selected = -1; return; }
  const t = game.tileTower[r * COLS + c];
  app.selected = t;
  ui.updateHud(0, true);
}

function upgradeSelected() {
  if (app.selected < 0) return;
  if (!game.upgradeTower(app.selected)) {
    const cost = game.upgradeCost(app.selected);
    ui.toast(cost === 0 ? 'Already at max level' : `Upgrade costs ${cost} gold`);
  }
  ui.updateHud(0, true);
}

function sellSelected() {
  if (app.selected < 0) return;
  game.sellTower(app.selected);
  app.selected = -1;
  ui.updateHud(0, true);
}

function cycleMode() {
  if (app.selected < 0) return;
  game.T.mode[app.selected] = (game.T.mode[app.selected] + 1) % 4;
  ui.updateHud(0, true);
}

function callWave() {
  if (game.startWave()) ui.updateHud(0, true);
}

function newGame() {
  game.reset();
  app.selected = -1;
  app.placing = -1;
  app.paused = false;
  ov.classList.remove('placing');
  ui.hideEnd();
  ui.showStart(false);
  ui.updateHud(0, true);
}

let restartArmed = 0;
function askRestart() {
  if (game.state === 'playing' && performance.now() - restartArmed > 1500) {
    restartArmed = performance.now();
    ui.toast('Press R again to restart');
    return;
  }
  newGame();
  ui.toast('New game');
}

function setSpeed(s) {
  app.speed = s;
  ui.updateHud(0, true);
}

function togglePause() {
  app.paused = !app.paused;
  ui.updateHud(0, true);
}

function startStress() {
  const nE = Math.max(0, Math.min(11000, Number($('st-e').value) || 0));
  const nT = Math.max(0, Math.min(400, Number($('st-t').value) || 0));
  const nP = Math.max(0, Math.min(7000, Number($('st-p').value) || 0));
  game.startStress(nE, nT, nP);
  app.selected = -1;
  app.placing = -1;
  app.paused = false;
  app.speed = 1;
  ui.hideEnd();
  ui.showStart(false);
  ui.togglePerf(true);
  ui.updateHud(0, true);
}

// ---------- dom buttons ----------

$('towers').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tower]');
  if (b) pickTower(Number(b.dataset.tower));
});
$('inspect').addEventListener('click', (e) => {
  const m = e.target.closest('[data-mode]');
  if (m && app.selected >= 0) { game.T.mode[app.selected] = Number(m.dataset.mode); ui.updateHud(0, true); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'upgrade') upgradeSelected();
  if (a.dataset.act === 'sell') sellSelected();
});
$('btn-wave').addEventListener('click', callWave);
$('btn-pause').addEventListener('click', togglePause);
$('btn-restart').addEventListener('click', askRestart);
$('btn-perf').addEventListener('click', () => ui.togglePerf());
$('perf-close').addEventListener('click', () => ui.togglePerf(false));
$('speed').addEventListener('click', (e) => {
  const b = e.target.closest('[data-speed]');
  if (b) setSpeed(Number(b.dataset.speed));
});
$('play').addEventListener('click', newGame);
$('again').addEventListener('click', newGame);
$('play-stress').addEventListener('click', startStress);
$('st-start').addEventListener('click', startStress);
$('st-exit').addEventListener('click', () => { newGame(); ui.toast('Back to a fresh game'); });

// optimization toggles
function applyOpt(name, on) {
  if (name === 'webgl') {
    app.settings.webgl = on && glr.ok;
    if (!app.settings.webgl) glr.clear();
  } else if (name === 'culling' || name === 'hudThrottle') {
    app.settings[name] = on;
  } else {
    game.opts[name] = on;
  }
}
document.querySelectorAll('[data-opt]').forEach((box) => {
  box.addEventListener('change', () => applyOpt(box.dataset.opt, box.checked));
});
function preset(on) {
  document.querySelectorAll('[data-opt]').forEach((box) => {
    if (box.disabled) return;
    box.checked = on;
    applyOpt(box.dataset.opt, on);
  });
}
$('preset-naive').addEventListener('click', () => preset(false));
$('preset-opt').addEventListener('click', () => preset(true));
$('fps-cap').addEventListener('change', (e) => { app.fpsCap = Number(e.target.value); });

// benchmark
let lastBench = '';
function configLabel() {
  const s = app.settings, o = game.opts;
  const on = [];
  if (s.webgl) on.push('webgl');
  if (o.spatialGrid) on.push('grid');
  if (s.culling) on.push('cull');
  if (o.throttleTarget) on.push('retarget');
  if (s.hudThrottle) on.push('hud');
  if (on.length === 0) return 'initial (all off)';
  if (on.length === 5) return 'all optimizations';
  return on.join(' + ');
}
$('bench-run').addEventListener('click', () => {
  const out = $('bench-out');
  out.className = '';
  out.textContent = 'Recording, keep the tab in front...';
  $('bench-run').disabled = true;
  perf.startBench(10, configLabel(), (r) => {
    $('bench-run').disabled = false;
    lastBench = Perf.toMarkdownRow(r);
    $('bench-copy').disabled = false;
    out.className = r.pass ? 'pass' : 'fail';
    out.textContent =
      `${r.label}\n` +
      `${r.enemies} enemies, ${r.towers} towers, ${r.projectiles} shots\n` +
      `avg ${r.avgFps.toFixed(1)} fps over ${r.frames} frames\n` +
      `frames at 45+ fps: ${r.pct45.toFixed(1)}%\n` +
      `frames over 33 ms: ${r.pct33.toFixed(1)}%\n` +
      `p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, p99 ${r.p99.toFixed(1)} ms\n` +
      `sim ${r.simMs.toFixed(2)} ms, render ${r.renderMs.toFixed(2)} ms\n` +
      `heap ${Number.isFinite(r.heapStart) ? r.heapStart.toFixed(1) + ' to ' + r.heapEnd.toFixed(1) + ' MB' : 'n/a'}\n` +
      `${r.pass ? 'PASS' : 'FAIL'} (needs 95% at 45+ fps and under 5% over 33 ms)`;
  }, () => ({ enemies: game.E.count, towers: game.T.count, projectiles: game.P.count }));
});
$('bench-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(lastBench); ui.toast('Row copied'); }
  catch (e) { ui.toast('Copy failed, select the text instead'); }
});

// ---------- mouse and touch ----------

let drag = null;
function updateHover(sx, sy) {
  const wx = cam.toWorldX(sx), wy = cam.toWorldY(sy);
  app.hoverC = Math.floor(wx / TILE);
  app.hoverR = Math.floor(wy / TILE);
}
ov.addEventListener('pointerdown', (e) => {
  ov.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, button: e.button };
});
ov.addEventListener('pointermove', (e) => {
  updateHover(e.clientX, e.clientY);
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
    drag.moved = true;
    ov.classList.add('dragging');
  }
  if (drag.moved) {
    cam.pan(e.clientX - drag.lx, e.clientY - drag.ly);
    drag.lx = e.clientX;
    drag.ly = e.clientY;
  }
});
ov.addEventListener('pointerup', (e) => {
  if (!drag) return;
  if (!drag.moved) {
    updateHover(e.clientX, e.clientY);
    if (drag.button === 0) clickTile(app.hoverC, app.hoverR);
    else if (drag.button === 2) cancel();
  }
  drag = null;
  ov.classList.remove('dragging');
});
ov.addEventListener('pointerleave', () => { if (!drag) { app.hoverC = -1; app.hoverR = -1; } });
ov.addEventListener('contextmenu', (e) => e.preventDefault());
ov.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

// ---------- keyboard ----------

const held = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  held.add(k);
  if (k >= '1' && k <= '4') pickTower(Number(k) - 1);
  else if (k === 'escape') cancel();
  else if (k === ' ') { e.preventDefault(); togglePause(); }
  else if (k === 'f') setSpeed(app.speed === 3 ? 1 : app.speed + 1);
  else if (k === 'n') callWave();
  else if (k === 'r') askRestart();
  else if (k === 'u') upgradeSelected();
  else if (k === 'x' || k === 'delete') sellSelected();
  else if (k === 't') cycleMode();
  else if (k === 'p') ui.togglePerf();
  else if (k === 'home' || k === '0') cam.fit();
});
window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());

function keyPan(dt) {
  let dx = 0, dy = 0;
  if (held.has('arrowleft') || held.has('a')) dx += 1;
  if (held.has('arrowright') || held.has('d')) dx -= 1;
  if (held.has('arrowup') || held.has('w')) dy += 1;
  if (held.has('arrowdown') || held.has('s')) dy -= 1;
  if (dx || dy) cam.pan(dx * 700 * dt, dy * 700 * dt);
}

// ---------- overlay (2d canvas on top) ----------

function drawOverlay(alpha) {
  const ctx = octx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ov.width, ov.height);
  const z = cam.zoom * dpr;
  ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);

  let drawn = 0;
  if (!app.settings.webgl) drawn = drawNaive(ctx, game, cam, alpha, app.settings.culling);

  const T = game.T;

  // build mode: grid, ghost tower, range
  if (app.placing >= 0) {
    const c0 = Math.max(0, Math.floor(cam.left() / TILE)), c1 = Math.min(COLS, Math.ceil(cam.right() / TILE));
    const r0 = Math.max(0, Math.floor(cam.top() / TILE)), r1 = Math.min(ROWS, Math.ceil(cam.bottom() / TILE));
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1 / cam.zoom;
    ctx.beginPath();
    for (let c = c0; c <= c1; c++) { ctx.moveTo(c * TILE, r0 * TILE); ctx.lineTo(c * TILE, r1 * TILE); }
    for (let r = r0; r <= r1; r++) { ctx.moveTo(c0 * TILE, r * TILE); ctx.lineTo(c1 * TILE, r * TILE); }
    ctx.stroke();

    const c = app.hoverC, r = app.hoverR;
    if (c >= 0 && r >= 0 && c < COLS && r < ROWS) {
      const def = TOWERS[app.placing];
      const ok = game.canPlace(c, r) && game.gold >= def.cost;
      const x = (c + 0.5) * TILE, y = (r + 0.5) * TILE;
      ctx.fillStyle = ok ? 'rgba(111,211,155,0.10)' : 'rgba(255,111,94,0.10)';
      ctx.strokeStyle = ok ? 'rgba(111,211,155,0.7)' : 'rgba(255,111,94,0.7)';
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.beginPath();
      ctx.arc(x, y, def.range, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ok ? 'rgba(111,211,155,0.35)' : 'rgba(255,111,94,0.35)';
      ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      const [cr, cg, cb] = def.color;
      ctx.fillStyle = `rgba(${cr},${cg},${cb},0.8)`;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (app.hoverC >= 0 && app.hoverR >= 0 && app.hoverC < COLS && app.hoverR < ROWS) {
    const t = game.tileTower[app.hoverR * COLS + app.hoverC];
    if (t >= 0 && t !== app.selected) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.strokeRect(T.col[t] * TILE + 1, T.row[t] * TILE + 1, TILE - 2, TILE - 2);
    }
  }

  // selected tower range
  const s = app.selected;
  if (s >= 0 && T.alive[s]) {
    const st = game.stats[T.type[s]][T.level[s]];
    ctx.fillStyle = 'rgba(232,181,74,0.07)';
    ctx.strokeStyle = 'rgba(232,181,74,0.85)';
    ctx.lineWidth = 1.5 / cam.zoom;
    ctx.setLineDash([6 / cam.zoom, 5 / cam.zoom]);
    ctx.beginPath();
    ctx.arc(T.x[s], T.y[s], st.range, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeRect(T.col[s] * TILE + 1, T.row[s] * TILE + 1, TILE - 2, TILE - 2);
  } else if (s >= 0) {
    app.selected = -1;
  }

  // floating text
  ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  for (const t of texts) {
    if (!t.on) continue;
    ctx.globalAlpha = Math.min(1, t.life * 1.5);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(t.s, t.x + 1, t.y + 1);
    ctx.fillStyle = t.color;
    ctx.fillText(t.s, t.x, t.y);
  }
  ctx.globalAlpha = 1;

  // screen space effects
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (game.leakFlash > 0) {
    const w = cam.viewW, h = cam.viewH;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(255,60,40,0)');
    g.addColorStop(1, `rgba(255,60,40,${(game.leakFlash * 0.8).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (app.paused) {
    ctx.fillStyle = 'rgba(10,18,14,0.35)';
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    ctx.font = 'bold 40px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eef3ea';
    ctx.fillText('Paused', cam.viewW / 2, cam.viewH / 2);
    ctx.font = '15px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#9fb3a6';
    ctx.fillText('Press space to resume', cam.viewW / 2, cam.viewH / 2 + 28);
  }
  return drawn;
}

function updateTexts(dt) {
  for (const t of texts) {
    if (!t.on) continue;
    t.life -= dt;
    t.y -= 26 * dt;
    if (t.life <= 0) t.on = false;
  }
}

// ---------- the one loop ----------

let last = performance.now();
let lastShown = last;
let acc = 0;
let drawn = 0;

function frame(now) {
  requestAnimationFrame(frame);

  // optional cap to show the game runs the same at any refresh rate
  if (app.fpsCap > 0 && now - lastShown < 1000 / app.fpsCap - 1) return;
  lastShown = now;

  const realDt = now - last;
  last = now;
  const dt = Math.min(0.25, realDt / 1000);

  keyPan(dt);

  // fixed timestep: the simulation always moves in 1/60 s steps,
  // no matter how often the screen refreshes
  const t0 = performance.now();
  if (!app.paused) {
    acc += dt * app.speed;
    // allow a little catch up, but never so much that one slow frame
    // makes the next frame even slower
    const maxSteps = app.speed * 2 + 2;
    let steps = 0;
    while (acc >= STEP && steps < maxSteps) {
      game.step(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === maxSteps) acc = 0; // too far behind, drop the rest
    updateTexts(dt * app.speed);
  }
  const t1 = performance.now();

  // render with interpolation between the last two ticks
  const alpha = app.paused ? 1 : acc / STEP;
  if (cam.dirty) { bg.draw(cam, dpr); cam.dirty = false; }
  if (app.settings.webgl) drawn = glr.render(game, cam, alpha, app.settings.culling);
  const d2 = drawOverlay(alpha);
  if (!app.settings.webgl) drawn = d2;
  const t2 = performance.now();

  perf.frame(realDt, t1 - t0, t2 - t1);
  ui.updateHud(dt, false);
  ui.updatePerf(dt, drawn);
}

ui.updateHud(0, true);
ui.showStart(true);
requestAnimationFrame(frame);

// handy for testing from the console
window.bastion = { game, cam, perf, app };
