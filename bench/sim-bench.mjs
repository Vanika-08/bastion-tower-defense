// sim-bench.mjs
// Runs the game simulation in node (no rendering) to measure:
//  1. cost of one tick in the stress scenario with each optimization on/off
//  2. a full 50 wave run played by a simple bot (balance + memory check)
//
// usage: node bench/sim-bench.mjs

import { Game } from '../src/sim.js';
import { STEP, COLS, ROWS, TILE, TOWERS } from '../src/config.js';

const now = () => performance.now();

function stressBench(label, opts, ticks = 300) {
  const g = new Game();
  Object.assign(g.opts, opts);
  g.startStress(5000, 100, 1000);
  for (let i = 0; i < 60; i++) g.step(STEP); // warm up
  const times = new Float64Array(ticks);
  let projSum = 0;
  for (let i = 0; i < ticks; i++) {
    const t0 = now();
    g.step(STEP);
    times[i] = now() - t0;
    projSum += g.P.count;
  }
  const sorted = Array.from(times).sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / ticks;
  const p95 = sorted[Math.floor(ticks * 0.95)];
  return { label, avg, p95, enemies: g.E.count, towers: g.T.count, proj: Math.round(projSum / ticks) };
}

function heapMB() {
  return process.memoryUsage().heapUsed / 1048576;
}

// bot: picks the free tile that sees the most path, keeps a mix of towers
function botRun(seedPlan) {
  const g = new Game();
  const map = g.map;
  const pathTiles = [];
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === 1) pathTiles.push(i);
  const coverage = (c, r, range) => {
    const x = (c + 0.5) * TILE, y = (r + 0.5) * TILE;
    let n = 0;
    for (const i of pathTiles) {
      const px = ((i % COLS) + 0.5) * TILE;
      const py = (Math.floor(i / COLS) + 0.5) * TILE;
      const dx = px - x, dy = py - y;
      if (dx * dx + dy * dy <= range * range) n++;
    }
    return n;
  };
  const plan = seedPlan;
  let planIdx = 0;
  const heap = [];
  g.startWave();
  let lastWave = 0;
  let ticks = 0;
  while (g.state === 'playing' && ticks < 60 * 60 * 90) {
    g.step(STEP);
    ticks++;
    if (ticks % 30 === 0) {
      // spend money
      const type = plan[planIdx % plan.length];
      const T = g.T;
      // prefer upgrades once we have enough towers
      let upgraded = false;
      if (T.count >= 10 + g.wave / 2) {
        let best = -1, bestCost = Infinity;
        for (let t = 0; t < T.hi; t++) {
          if (!T.alive[t]) continue;
          const c = g.upgradeCost(t);
          if (c > 0 && c < bestCost) { bestCost = c; best = t; }
        }
        if (best >= 0 && g.gold >= bestCost) upgraded = g.upgradeTower(best);
      }
      if (!upgraded && g.gold >= TOWERS[type].cost) {
        let bc = -1, br = -1, bs = -1;
        const range = TOWERS[type].range;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          if (!g.canPlace(c, r)) continue;
          const s = coverage(c, r, range);
          if (s > bs) { bs = s; bc = c; br = r; }
        }
        if (bc >= 0 && g.placeTower(type, bc, br) >= 0) planIdx++;
      }
    }
    if (g.wave !== lastWave) {
      lastWave = g.wave;
      if (g.wave % 5 === 0) heap.push(heapMB().toFixed(1));
    }
  }
  return { state: g.state, wave: g.wave, lives: g.lives, score: g.score, towers: g.T.count, heap };
}

if (!process.env.SKIP_STRESS) {
console.log('== stress tick cost (5000 enemies, 100 towers, >=1000 projectiles) ==');
const rows = [
  stressBench('naive (no grid, retarget every tick)', { spatialGrid: false, throttleTarget: false }, 60),
  stressBench('throttled retarget only', { spatialGrid: false, throttleTarget: true }, 60),
  stressBench('spatial grid only', { spatialGrid: true, throttleTarget: false }),
  stressBench('grid + throttle (final)', { spatialGrid: true, throttleTarget: true }),
];
for (const r of rows) {
  console.log(`${r.label.padEnd(40)} avg ${r.avg.toFixed(2)} ms  p95 ${r.p95.toFixed(2)} ms  enemies ${r.enemies} towers ${r.towers} proj ${r.proj}`);
}

}
console.log('\n== full 50 wave bot runs ==');
const mixed = botRun([0, 0, 2, 1, 0, 3, 1, 2, 3, 0, 1, 3]);
console.log('mixed towers + upgrades:', JSON.stringify(mixed));
const gunOnly = botRun([0]);
console.log('gunners only:          ', JSON.stringify(gunOnly));
