// map.js
// Builds the tile grid and the path geometry enemies walk along.

import { TILE, COLS, ROWS, PATHS, BASE_TILE } from './config.js';

// tile kinds
export const T_GRASS = 0;
export const T_PATH = 1;
export const T_ROCK = 2;
export const T_TREE = 3;
export const T_BASE = 4;

// small seeded random so the map looks the same every time
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildMap() {
  const tiles = new Uint8Array(COLS * ROWS);

  // mark path tiles
  for (const pts of PATHS) {
    for (let i = 0; i < pts.length - 1; i++) {
      let [c0, r0] = pts[i];
      const [c1, r1] = pts[i + 1];
      const dc = Math.sign(c1 - c0);
      const dr = Math.sign(r1 - r0);
      while (true) {
        if (c0 >= 0 && c0 < COLS && r0 >= 0 && r0 < ROWS) tiles[r0 * COLS + c0] = T_PATH;
        if (c0 === c1 && r0 === r1) break;
        c0 += dc;
        r0 += dr;
      }
    }
  }

  // base takes a 3x3 block
  for (let r = BASE_TILE[1] - 1; r <= BASE_TILE[1] + 1; r++) {
    for (let c = BASE_TILE[0] - 1; c <= BASE_TILE[0] + 1; c++) {
      tiles[r * COLS + c] = T_BASE;
    }
  }

  // distance (in tiles) from every tile to the nearest path tile
  const distToPath = new Int16Array(COLS * ROWS).fill(-1);
  const queue = new Int32Array(COLS * ROWS);
  let qh = 0, qt = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === T_PATH) { distToPath[i] = 0; queue[qt++] = i; }
  }
  while (qh < qt) {
    const i = queue[qh++];
    const c = i % COLS, r = (i / COLS) | 0;
    const nb = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
    for (const [nc, nr] of nb) {
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const j = nr * COLS + nc;
      if (distToPath[j] !== -1) continue;
      distToPath[j] = distToPath[i] + 1;
      queue[qt++] = j;
    }
  }

  // scatter rocks and trees away from the path
  const rng = makeRng(1337);
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== T_GRASS) continue;
    const d = distToPath[i];
    if (d < 2) continue;
    const roll = rng();
    const chance = d > 4 ? 0.09 : 0.035;
    if (roll < chance) tiles[i] = rng() < 0.55 ? T_TREE : T_ROCK;
  }

  // path geometry in world pixels, with cumulative lengths
  const paths = PATHS.map((pts) => {
    const n = pts.length;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const cum = new Float32Array(n);
    const nx = new Float32Array(n); // segment normal
    const ny = new Float32Array(n);
    const dx = new Float32Array(n); // segment direction
    const dy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = (pts[i][0] + 0.5) * TILE;
      ys[i] = (pts[i][1] + 0.5) * TILE;
    }
    for (let i = 0; i < n - 1; i++) {
      const lx = xs[i + 1] - xs[i];
      const ly = ys[i + 1] - ys[i];
      const len = Math.hypot(lx, ly);
      cum[i + 1] = cum[i] + len;
      dx[i] = lx / len; dy[i] = ly / len;
      nx[i] = -dy[i]; ny[i] = dx[i];
    }
    return { n, xs, ys, cum, nx, ny, dx, dy, total: cum[n - 1] };
  });

  return { tiles, distToPath, paths };
}

export function isBuildable(map, c, r) {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  return map.tiles[r * COLS + c] === T_GRASS;
}
