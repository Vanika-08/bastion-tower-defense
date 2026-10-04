// sim.js
// The whole game simulation. It has no DOM code, so the same file
// runs in the browser and in the node benchmark (bench/sim-bench.mjs).
//
// Every entity type is stored as a "struct of arrays": one typed array
// per field, plus a free list of slot indices. Nothing is allocated
// while the game is running (unless the naive options are turned on).

import {
  TILE, COLS, ROWS, WORLD_W, WORLD_H, MAX_ENEMIES, MAX_TOWERS, MAX_PROJ, MAX_FX,
  START_GOLD, START_LIVES, TOTAL_WAVES, WAVE_GAP, SELL_RATE,
  TOWERS, ENEMIES, LEVEL_DMG, LEVEL_RATE, LEVEL_RANGE, LEVEL_UP_COST, MAX_LEVEL, rgba,
} from './config.js';
import { buildMap, isBuildable, makeRng } from './map.js';
import { SpatialGrid } from './grid.js';
import { buildWave, hpMult, armorBonus, rewardMult } from './waves.js';

// ---------- storage helpers ----------

function makePool(cap) {
  const free = new Int32Array(cap);
  for (let i = 0; i < cap; i++) free[i] = cap - 1 - i; // low slots first
  return { cap, hi: 0, count: 0, free, freeTop: cap, alive: new Uint8Array(cap), gen: new Uint16Array(cap) };
}

function alloc(S) {
  if (S.freeTop === 0) return -1;
  const i = S.free[--S.freeTop];
  S.alive[i] = 1;
  S.gen[i] = (S.gen[i] + 1) & 0xffff;
  if (i >= S.hi) S.hi = i + 1;
  S.count++;
  return i;
}

function release(S, i) {
  S.alive[i] = 0;
  S.gen[i] = (S.gen[i] + 1) & 0xffff;
  S.free[S.freeTop++] = i;
  S.count--;
}

// shrink the scan range when the top slots are empty
function trimHi(S) {
  let h = S.hi;
  while (h > 0 && !S.alive[h - 1]) h--;
  S.hi = h;
}

function clearPool(S) {
  S.alive.fill(0);
  S.hi = 0;
  S.count = 0;
  for (let i = 0; i < S.cap; i++) S.free[i] = S.cap - 1 - i;
  S.freeTop = S.cap;
}

function makeEnemies(cap) {
  const S = makePool(cap);
  const f = () => new Float32Array(cap);
  Object.assign(S, {
    type: new Uint8Array(cap), path: new Uint8Array(cap), seg: new Uint16Array(cap),
    x: f(), y: f(), px: f(), py: f(), dist: f(), off: f(), hp: f(), maxHp: f(),
    speed: f(), armor: f(), reward: f(), slowT: f(), slowF: f(), flash: f(), radius: f(), heading: f(),
  });
  return S;
}

function makeTowers(cap) {
  const S = makePool(cap);
  const f = () => new Float32Array(cap);
  Object.assign(S, {
    type: new Uint8Array(cap), level: new Uint8Array(cap), mode: new Uint8Array(cap),
    col: new Int16Array(cap), row: new Int16Array(cap),
    x: f(), y: f(), cd: f(), retarget: f(), angle: f(), recoil: f(), spent: f(),
    tgt: new Int32Array(cap), tgtGen: new Uint16Array(cap), kills: new Uint32Array(cap),
  });
  return S;
}

function makeProjectiles(cap) {
  const S = makePool(cap);
  const f = () => new Float32Array(cap);
  Object.assign(S, {
    kind: new Uint8Array(cap), homing: new Uint8Array(cap), pierce: new Uint8Array(cap),
    x: f(), y: f(), px: f(), py: f(), tx: f(), ty: f(), speed: f(), dmg: f(),
    splash: f(), slowF: f(), slowT: f(), life: f(), angle: f(),
    tgt: new Int32Array(cap), tgtGen: new Uint16Array(cap), src: new Int32Array(cap),
  });
  return S;
}

function makeFx(cap) {
  const S = makePool(cap);
  const f = () => new Float32Array(cap);
  Object.assign(S, {
    kind: new Uint8Array(cap), color: new Uint32Array(cap),
    x: f(), y: f(), vx: f(), vy: f(), life: f(), max: f(), size: f(),
  });
  return S;
}

// ---------- the game ----------

export class Game {
  constructor() {
    this.map = buildMap();
    this.E = makeEnemies(MAX_ENEMIES);
    this.T = makeTowers(MAX_TOWERS);
    this.P = makeProjectiles(MAX_PROJ);
    this.F = makeFx(MAX_FX);
    this.grid = new SpatialGrid(WORLD_W, WORLD_H, 32, MAX_ENEMIES);
    this.tileTower = new Int16Array(COLS * ROWS);

    // perf options (toggled from the perf panel)
    this.opts = { spatialGrid: true, throttleTarget: true };

    // tower stats per type and level, computed once
    this.stats = TOWERS.map((def) => [0, 1, 2, 3].map((l) => ({
      damage: def.damage * LEVEL_DMG[l],
      rate: def.rate * LEVEL_RATE[l],
      range: def.range * LEVEL_RANGE[l],
      splash: def.splash * (1 + 0.12 * l),
      slowTime: def.slowTime * (1 + 0.15 * l),
      upCost: l < MAX_LEVEL ? Math.round(def.cost * LEVEL_UP_COST[l]) : 0,
    })));

    this.enemyColor = ENEMIES.map((e) => rgba(e.color[0], e.color[1], e.color[2]));
    this.towerColor = TOWERS.map((t) => rgba(t.color[0], t.color[1], t.color[2]));

    this.listener = null; // ui hooks into events through this
    this.sx = 0; // scratch output for samplePath
    this.sy = 0;
    this.reset();
  }

  emit(type, x, y, v) {
    if (this.listener) this.listener(type, x, y, v);
  }

  reset() {
    clearPool(this.E); clearPool(this.T); clearPool(this.P); clearPool(this.F);
    this.tileTower.fill(-1);
    this.gold = START_GOLD;
    this.lives = START_LIVES;
    this.score = 0;
    this.wave = 0;
    this.kills = 0;
    this.time = 0;
    this.state = 'ready'; // ready | playing | won | lost | stress
    this.spawners = [];
    this.nextTimer = 0;
    this.cleared = true;
    this.stress = null;
    this.leakFlash = 0;
  }

  // ---------- path helpers ----------

  // world position at distance d along path p, with a sideways offset.
  // writes into this.sx / this.sy and returns the segment index.
  samplePath(p, d, off, seg) {
    const P = this.map.paths[p];
    let s = seg;
    while (s < P.n - 2 && d > P.cum[s + 1]) s++;
    const t = d - P.cum[s];
    let nx = P.nx[s], ny = P.ny[s];
    // blend the side normal near corners so enemies do not snap
    const B = 12;
    const rem = P.cum[s + 1] - d;
    if (rem < B && s < P.n - 2) {
      const w = 0.5 * (1 - rem / B);
      nx += (P.nx[s + 1] - nx) * w; ny += (P.ny[s + 1] - ny) * w;
    } else if (t < B && s > 0) {
      const w = 0.5 * (1 - t / B);
      nx += (P.nx[s - 1] - nx) * w; ny += (P.ny[s - 1] - ny) * w;
    }
    this.sx = P.xs[s] + P.dx[s] * t + nx * off;
    this.sy = P.ys[s] + P.dy[s] * t + ny * off;
    return s;
  }

  // ---------- enemies ----------

  spawnEnemy(type, path, hpm, armorAdd, rwm, startDist) {
    const E = this.E;
    const i = alloc(E);
    if (i < 0) return -1;
    const def = ENEMIES[type];
    E.type[i] = type;
    E.path[i] = path;
    E.hp[i] = E.maxHp[i] = def.hp * hpm;
    E.speed[i] = def.speed * (0.94 + Math.random() * 0.12);
    E.armor[i] = def.armor > 0 ? def.armor + armorAdd : 0;
    E.reward[i] = def.reward * rwm;
    E.radius[i] = def.radius;
    E.slowT[i] = 0;
    E.slowF[i] = 1;
    E.flash[i] = 0;
    const room = Math.max(0, 15 - def.radius);
    E.off[i] = (Math.random() * 2 - 1) * room;
    E.dist[i] = startDist;
    E.seg[i] = this.samplePath(path, startDist, E.off[i], 0);
    E.x[i] = E.px[i] = this.sx;
    E.y[i] = E.py[i] = this.sy;
    E.heading[i] = 0;
    return i;
  }

  killEnemy(i, src) {
    const E = this.E;
    const x = E.x[i], y = E.y[i], type = E.type[i];
    if (this.state !== 'stress') {
      this.gold += E.reward[i];
      this.score += Math.round(E.reward[i] * 10);
      this.kills++;
    }
    if (src >= 0 && this.T.alive[src]) this.T.kills[src]++;
    release(E, i);
    this.burst(x, y, this.enemyColor[type], type === 4 ? 18 : 5, type === 4 ? 3 : 1);
    this.emit('kill', x, y, type);
  }

  updateEnemies(dt) {
    const E = this.E, paths = this.map.paths;
    const stress = this.state === 'stress';
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      E.px[i] = E.x[i];
      E.py[i] = E.y[i];
      let sp = E.speed[i];
      if (E.slowT[i] > 0) { E.slowT[i] -= dt; sp *= E.slowF[i]; }
      if (E.flash[i] > 0) E.flash[i] -= dt;
      const P = paths[E.path[i]];
      let d = E.dist[i] + sp * dt;
      if (d >= P.total) {
        if (stress) {
          // loop back to the start during the stress test
          d = 0;
          E.seg[i] = 0;
          E.dist[i] = 0;
          E.seg[i] = this.samplePath(E.path[i], 0, E.off[i], 0);
          E.x[i] = E.px[i] = this.sx;
          E.y[i] = E.py[i] = this.sy;
          continue;
        }
        this.leak(i);
        continue;
      }
      E.dist[i] = d;
      E.seg[i] = this.samplePath(E.path[i], d, E.off[i], E.seg[i]);
      E.heading[i] = Math.atan2(this.sy - E.y[i], this.sx - E.x[i]);
      E.x[i] = this.sx;
      E.y[i] = this.sy;
    }
    trimHi(E);
  }

  leak(i) {
    const E = this.E;
    const dmg = ENEMIES[E.type[i]].dmg;
    release(E, i);
    this.lives = Math.max(0, this.lives - dmg);
    this.leakFlash = 0.4;
    this.emit('leak', 0, 0, dmg);
    if (this.lives <= 0 && this.state === 'playing') {
      this.state = 'lost';
      this.emit('lost', 0, 0, 0);
    }
  }

  damage(i, amount, pierce, src) {
    const E = this.E;
    const a = pierce ? amount : Math.max(amount * 0.25, amount - E.armor[i]);
    E.hp[i] -= a;
    E.flash[i] = 0.08;
    if (E.hp[i] <= 0) this.killEnemy(i, src);
  }

  // ---------- targeting ----------

  scoreTarget(i, mode, x, y) {
    const E = this.E;
    if (mode === 0) return E.dist[i];
    if (mode === 1) return -E.dist[i];
    if (mode === 2) return E.hp[i] + E.dist[i] * 0.001;
    const dx = E.x[i] - x, dy = E.y[i] - y;
    return -(dx * dx + dy * dy);
  }

  // fast version: only look at grid cells inside the range box
  findTargetGrid(x, y, range, mode) {
    const E = this.E, g = this.grid;
    const k = g.query(x, y, range);
    const out = g.out, r2 = range * range;
    let best = -1, bestScore = -Infinity;
    for (let j = 0; j < k; j++) {
      const i = out[j];
      if (!E.alive[i]) continue;
      const dx = E.x[i] - x, dy = E.y[i] - y;
      if (dx * dx + dy * dy > r2) continue;
      const s = this.scoreTarget(i, mode, x, y);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return best;
  }

  // naive version: scan every enemy, build an array, sort it.
  // this is how the first version was written.
  findTargetNaive(x, y, range, mode) {
    const E = this.E, r2 = range * range;
    const inRange = [];
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      const dx = E.x[i] - x, dy = E.y[i] - y;
      if (dx * dx + dy * dy <= r2) inRange.push(i);
    }
    if (inRange.length === 0) return -1;
    inRange.sort((a, b) => this.scoreTarget(b, mode, x, y) - this.scoreTarget(a, mode, x, y));
    return inRange[0];
  }

  // ---------- towers ----------

  canPlace(c, r) {
    return isBuildable(this.map, c, r) && this.tileTower[r * COLS + c] === -1;
  }

  placeTower(type, c, r, free = false) {
    if (!this.canPlace(c, r)) return -1;
    const def = TOWERS[type];
    if (!free && this.gold < def.cost) return -1;
    const T = this.T;
    const t = alloc(T);
    if (t < 0) return -1;
    if (!free) this.gold -= def.cost;
    T.type[t] = type; T.level[t] = 0; T.mode[t] = def.defaultMode;
    T.col[t] = c; T.row[t] = r;
    T.x[t] = (c + 0.5) * TILE; T.y[t] = (r + 0.5) * TILE;
    T.cd[t] = 0; T.retarget[t] = 0; T.angle[t] = -Math.PI / 2; T.recoil[t] = 0;
    T.spent[t] = def.cost; T.tgt[t] = -1; T.kills[t] = 0;
    this.tileTower[r * COLS + c] = t;
    this.emit('place', T.x[t], T.y[t], type);
    return t;
  }

  upgradeCost(t) {
    const T = this.T;
    if (T.level[t] >= MAX_LEVEL) return 0;
    return this.stats[T.type[t]][T.level[t]].upCost;
  }

  upgradeTower(t) {
    const T = this.T;
    if (!T.alive[t] || T.level[t] >= MAX_LEVEL) return false;
    const cost = this.upgradeCost(t);
    if (this.gold < cost) return false;
    this.gold -= cost;
    T.spent[t] += cost;
    T.level[t]++;
    this.ring(T.x[t], T.y[t], this.towerColor[T.type[t]], 26, 0.45);
    this.emit('upgrade', T.x[t], T.y[t], T.level[t]);
    return true;
  }

  sellValue(t) {
    return Math.floor(this.T.spent[t] * SELL_RATE);
  }

  sellTower(t) {
    const T = this.T;
    if (!T.alive[t]) return 0;
    const v = this.sellValue(t);
    this.gold += v;
    this.tileTower[T.row[t] * COLS + T.col[t]] = -1;
    this.burst(T.x[t], T.y[t], rgba(255, 220, 120), 8, 1);
    this.emit('sell', T.x[t], T.y[t], v);
    release(T, t);
    trimHi(T);
    return v;
  }

  updateTowers(dt) {
    const T = this.T, E = this.E;
    const useGrid = this.opts.spatialGrid;
    const throttle = this.opts.throttleTarget;
    for (let t = 0; t < T.hi; t++) {
      if (!T.alive[t]) continue;
      const st = this.stats[T.type[t]][T.level[t]];
      const x = T.x[t], y = T.y[t], range = st.range;
      if (T.recoil[t] > 0) T.recoil[t] -= dt;
      T.cd[t] -= dt;
      T.retarget[t] -= dt;

      let tg = T.tgt[t];
      let valid = tg >= 0 && E.alive[tg] && E.gen[tg] === T.tgtGen[t];
      if (valid) {
        const dx = E.x[tg] - x, dy = E.y[tg] - y;
        valid = dx * dx + dy * dy <= range * range;
      }
      if (!valid || !throttle || T.retarget[t] <= 0) {
        tg = useGrid ? this.findTargetGrid(x, y, range, T.mode[t]) : this.findTargetNaive(x, y, range, T.mode[t]);
        T.tgt[t] = tg;
        if (tg >= 0) T.tgtGen[t] = E.gen[tg];
        T.retarget[t] = 0.1;
      }

      if (tg < 0) {
        if (T.cd[t] < 0) T.cd[t] = 0;
        continue;
      }
      T.angle[t] = Math.atan2(E.y[tg] - y, E.x[tg] - x);
      if (T.cd[t] <= 0) {
        this.fire(t, tg, st);
        T.cd[t] += 1 / st.rate;
        if (T.cd[t] < 0) T.cd[t] = 0;
      }
    }
  }

  fire(t, tg, st) {
    const T = this.T, E = this.E, P = this.P;
    const type = T.type[t];
    const def = TOWERS[type];
    const p = alloc(P);
    if (p < 0) return;
    const a = T.angle[t];
    const x = T.x[t] + Math.cos(a) * 13;
    const y = T.y[t] + Math.sin(a) * 13;
    P.x[p] = P.px[p] = x;
    P.y[p] = P.py[p] = y;
    P.kind[p] = type;
    P.homing[p] = def.homing ? 1 : 0;
    P.pierce[p] = def.pierce ? 1 : 0;
    P.speed[p] = def.projSpeed;
    P.dmg[p] = st.damage;
    P.splash[p] = st.splash;
    P.slowF[p] = def.slow > 0 ? 1 - def.slow : 1;
    P.slowT[p] = st.slowTime;
    P.tgt[p] = tg;
    P.tgtGen[p] = E.gen[tg];
    P.src[p] = t;
    P.angle[p] = a;
    if (def.homing) {
      P.tx[p] = E.x[tg];
      P.ty[p] = E.y[tg];
      P.life[p] = 2.5;
    } else {
      // lead the shot: guess where the enemy will be when the shell lands
      const dx = E.x[tg] - x, dy = E.y[tg] - y;
      const flight = Math.sqrt(dx * dx + dy * dy) / def.projSpeed;
      let sp = E.speed[tg];
      if (E.slowT[tg] > 0) sp *= E.slowF[tg];
      const path = this.map.paths[E.path[tg]];
      const d = Math.min(path.total - 1, E.dist[tg] + sp * flight);
      this.samplePath(E.path[tg], d, E.off[tg], E.seg[tg]);
      P.tx[p] = this.sx;
      P.ty[p] = this.sy;
      P.life[p] = 5;
    }
    T.recoil[t] = 0.08;
  }

  // ---------- projectiles ----------

  // first enemy touching point (x, y)
  findHit(x, y, pr) {
    const E = this.E;
    if (this.opts.spatialGrid) {
      const g = this.grid;
      const k = g.query(x, y, pr + 18);
      const out = g.out;
      for (let j = 0; j < k; j++) {
        const i = out[j];
        if (!E.alive[i]) continue;
        const dx = E.x[i] - x, dy = E.y[i] - y, rr = E.radius[i] + pr;
        if (dx * dx + dy * dy < rr * rr) return i;
      }
      return -1;
    }
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      const dx = E.x[i] - x, dy = E.y[i] - y, rr = E.radius[i] + pr;
      if (dx * dx + dy * dy < rr * rr) return i;
    }
    return -1;
  }

  explode(p, x, y) {
    const E = this.E, P = this.P;
    const r = P.splash[p];
    const dmg = P.dmg[p], pierce = P.pierce[p] === 1, src = P.src[p];
    const slowF = P.slowF[p], slowT = P.slowT[p];
    const slows = slowF < 1;
    if (this.opts.spatialGrid) {
      const g = this.grid;
      const k = g.query(x, y, r + 18);
      const out = g.out;
      for (let j = 0; j < k; j++) {
        const i = out[j];
        if (!E.alive[i]) continue;
        const dx = E.x[i] - x, dy = E.y[i] - y, rr = r + E.radius[i];
        if (dx * dx + dy * dy > rr * rr) continue;
        if (slows) { E.slowT[i] = slowT; E.slowF[i] = slowF; }
        this.damage(i, dmg, pierce, src);
      }
    } else {
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i]) continue;
        const dx = E.x[i] - x, dy = E.y[i] - y, rr = r + E.radius[i];
        if (dx * dx + dy * dy > rr * rr) continue;
        if (slows) { E.slowT[i] = slowT; E.slowF[i] = slowF; }
        this.damage(i, dmg, pierce, src);
      }
    }
    const kind = P.kind[p];
    this.ring(x, y, kind === 2 ? rgba(170, 225, 255, 200) : rgba(255, 170, 80, 220), r, kind === 2 ? 0.35 : 0.3);
    if (kind === 1) this.burst(x, y, rgba(255, 190, 90), 4, 1.4);
  }

  updateProjectiles(dt) {
    const P = this.P, E = this.E;
    for (let p = 0; p < P.hi; p++) {
      if (!P.alive[p]) continue;
      P.px[p] = P.x[p];
      P.py[p] = P.y[p];

      if (P.homing[p] && P.tgt[p] >= 0) {
        const tg = P.tgt[p];
        if (E.alive[tg] && E.gen[tg] === P.tgtGen[p]) {
          P.tx[p] = E.x[tg];
          P.ty[p] = E.y[tg];
        } else {
          P.tgt[p] = -1; // target died, keep flying to last spot
        }
      }

      const dx = P.tx[p] - P.x[p], dy = P.ty[p] - P.y[p];
      const d = Math.sqrt(dx * dx + dy * dy);
      const step = P.speed[p] * dt;

      if (!P.homing[p]) {
        // shells fly over enemies and blow up at the target point
        if (d <= step) {
          this.explode(p, P.tx[p], P.ty[p]);
          release(P, p);
          continue;
        }
        P.x[p] += (dx / d) * step;
        P.y[p] += (dy / d) * step;
        P.angle[p] = Math.atan2(dy, dx);
      } else {
        if (d > 0.001) {
          const m = Math.min(step, d) / d;
          P.x[p] += dx * m;
          P.y[p] += dy * m;
          P.angle[p] = Math.atan2(dy, dx);
        }
        const hit = this.findHit(P.x[p], P.y[p], 3);
        if (hit >= 0) {
          if (P.splash[p] > 0) this.explode(p, P.x[p], P.y[p]);
          else {
            this.damage(hit, P.dmg[p], P.pierce[p] === 1, P.src[p]);
            if (P.kind[p] === 3) this.burst(P.x[p], P.y[p], rgba(220, 180, 255), 3, 1);
          }
          release(P, p);
          continue;
        }
        if (P.tgt[p] < 0 && d <= step) {
          release(P, p);
          continue;
        }
      }
      P.life[p] -= dt;
      if (P.life[p] <= 0) release(P, p);
    }
    trimHi(P);
  }

  // ---------- effects ----------

  burst(x, y, color, n, scale) {
    const F = this.F;
    for (let k = 0; k < n; k++) {
      const i = alloc(F);
      if (i < 0) return;
      const a = Math.random() * Math.PI * 2;
      const s = (40 + Math.random() * 90) * scale;
      F.kind[i] = 0;
      F.x[i] = x; F.y[i] = y;
      F.vx[i] = Math.cos(a) * s; F.vy[i] = Math.sin(a) * s;
      F.life[i] = F.max[i] = 0.3 + Math.random() * 0.25;
      F.size[i] = (1.6 + Math.random() * 1.6) * scale;
      F.color[i] = color;
    }
  }

  ring(x, y, color, size, life) {
    const F = this.F;
    const i = alloc(F);
    if (i < 0) return;
    F.kind[i] = 1;
    F.x[i] = x; F.y[i] = y; F.vx[i] = 0; F.vy[i] = 0;
    F.life[i] = F.max[i] = life;
    F.size[i] = size;
    F.color[i] = color;
  }

  updateFx(dt) {
    const F = this.F;
    const drag = Math.pow(0.02, dt);
    for (let i = 0; i < F.hi; i++) {
      if (!F.alive[i]) continue;
      F.life[i] -= dt;
      if (F.life[i] <= 0) { release(F, i); continue; }
      F.x[i] += F.vx[i] * dt;
      F.y[i] += F.vy[i] * dt;
      F.vx[i] *= drag;
      F.vy[i] *= drag;
    }
    trimHi(F);
  }

  // ---------- waves ----------

  canCallWave() {
    return (this.state === 'ready' || this.state === 'playing') && this.wave < TOTAL_WAVES && this.spawners.length === 0;
  }

  startWave() {
    if (!this.canCallWave()) return false;
    // calling early pays a small bonus
    if (this.state === 'playing') {
      const early = this.cleared ? Math.ceil(this.nextTimer) * 2 : 15;
      if (early > 0) { this.gold += early; this.emit('early', 0, 0, early); }
    }
    this.state = 'playing';
    this.wave++;
    const n = this.wave;
    const hpm = hpMult(n), arm = armorBonus(n), rwm = rewardMult(n);
    for (const g of buildWave(n)) {
      this.spawners.push({ type: g.type, left: g.count, interval: g.interval, t: g.delay, path: g.path, hpm, arm, rwm });
    }
    this.cleared = false;
    this.nextTimer = 0;
    this.emit('wave', 0, 0, n);
    return true;
  }

  updateSpawners(dt) {
    const list = this.spawners;
    for (let k = list.length - 1; k >= 0; k--) {
      const s = list[k];
      s.t -= dt;
      while (s.t <= 0 && s.left > 0) {
        this.spawnEnemy(s.type, s.path, s.hpm, s.arm, s.rwm, 0);
        s.left--;
        s.t += s.interval;
      }
      if (s.left <= 0) list.splice(k, 1);
    }
  }

  updateWaveState(dt) {
    if (this.state !== 'playing') return;
    if (this.spawners.length > 0 || this.E.count > 0) return;
    if (!this.cleared) {
      this.cleared = true;
      if (this.wave >= TOTAL_WAVES) {
        this.score += this.lives * 500;
        this.state = 'won';
        this.emit('won', 0, 0, 0);
        return;
      }
      const bonus = 20 + this.wave * 3;
      this.gold += bonus;
      this.score += this.wave * 50;
      this.nextTimer = WAVE_GAP;
      this.emit('cleared', 0, 0, bonus);
      return;
    }
    this.nextTimer -= dt;
    if (this.nextTimer <= 0) {
      this.nextTimer = 0;
      this.startWave();
    }
  }

  // ---------- stress test ----------

  startStress(nEnemies, nTowers, nProj) {
    this.reset();
    this.state = 'stress';
    this.stress = { nEnemies, nTowers, nProj };
    this.gold = 0;

    // towers go on the buildable tiles closest to the path
    const rng = makeRng(99);
    const cand = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.canPlace(c, r)) cand.push({ c, r, d: this.map.distToPath[r * COLS + c], k: rng() });
      }
    }
    cand.sort((a, b) => (a.d - b.d) || (a.k - b.k));
    const nt = Math.min(nTowers, cand.length, MAX_TOWERS);
    for (let k = 0; k < nt; k++) {
      const t = this.placeTower(k % 4, cand[k].c, cand[k].r, true);
      if (t >= 0) this.T.level[t] = k % 4;
    }

    for (let k = 0; k < nEnemies; k++) this.spawnStressEnemy(true);
  }

  spawnStressEnemy(anywhere) {
    const roll = Math.random();
    const type = roll < 0.4 ? 0 : roll < 0.65 ? 1 : roll < 0.8 ? 2 : roll < 0.98 ? 3 : 4;
    const path = Math.random() < 0.5 ? 0 : 1;
    const total = this.map.paths[path].total;
    const d = anywhere ? Math.random() * total * 0.98 : 0;
    return this.spawnEnemy(type, path, 6, 0, 0, d);
  }

  maintainStress() {
    const s = this.stress;
    const E = this.E, T = this.T, P = this.P;
    // keep the enemy count steady: killed ones come back somewhere on the path
    let guard = 0;
    while (E.count < s.nEnemies && guard++ < 2000) {
      if (this.spawnStressEnemy(true) < 0) break;
    }
    // keep at least nProj shots in the air
    guard = 0;
    while (P.count < s.nProj && T.count > 0 && E.count > 0 && guard++ < 4000) {
      const t = this.randomAlive(T);
      const e = this.randomAlive(E);
      if (t < 0 || e < 0) break;
      T.angle[t] = Math.atan2(E.y[e] - T.y[t], E.x[e] - T.x[t]);
      const before = P.count;
      this.fire(t, e, this.stats[T.type[t]][T.level[t]]);
      if (P.count === before) break;
    }
  }

  randomAlive(S) {
    if (S.count === 0) return -1;
    for (let k = 0; k < 64; k++) {
      const i = (Math.random() * S.hi) | 0;
      if (S.alive[i]) return i;
    }
    for (let i = 0; i < S.hi; i++) if (S.alive[i]) return i;
    return -1;
  }

  // ---------- one fixed tick ----------

  step(dt) {
    if (this.leakFlash > 0) this.leakFlash -= dt;
    if (this.state === 'won' || this.state === 'lost') {
      this.updateFx(dt);
      return;
    }
    this.time += dt;
    if (this.state === 'playing') this.updateSpawners(dt);
    this.updateEnemies(dt);
    if (this.opts.spatialGrid) this.grid.build(this.E);
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.updateFx(dt);
    if (this.state === 'stress') this.maintainStress();
    this.updateWaveState(dt);
  }
}
