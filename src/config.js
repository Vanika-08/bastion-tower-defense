// config.js
// All the numbers that define the game live here.

export const TILE = 32;
export const COLS = 50;
export const ROWS = 30;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;

// simulation runs at a fixed 60 ticks per second
export const STEP = 1 / 60;

// hard limits for pooled storage (never resized at runtime)
export const MAX_ENEMIES = 12000;
export const MAX_TOWERS = 400;
export const MAX_PROJ = 8000;
export const MAX_FX = 6000;

export const START_GOLD = 220;
export const START_LIVES = 30;
export const TOTAL_WAVES = 50;
export const WAVE_GAP = 12; // seconds between waves
export const SELL_RATE = 0.7;

// pack an rgb color into one uint32 (abgr byte order for webgl)
export function rgba(r, g, b, a = 255) {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

// tower types
// targeting modes: 0 first, 1 last, 2 strong, 3 close
export const TOWERS = [
  {
    key: 'gunner', name: 'Gunner', hotkey: '1', cost: 50,
    color: [77, 225, 255], range: 115, rate: 4, damage: 7, projSpeed: 560,
    splash: 0, slow: 0, slowTime: 0, pierce: false, homing: true, defaultMode: 0,
    desc: 'Rapid single shots. Cheap, but armor blunts each bullet.',
  },
  {
    key: 'cannon', name: 'Cannon', hotkey: '2', cost: 120,
    color: [255, 158, 74], range: 135, rate: 0.75, damage: 32, projSpeed: 300,
    splash: 58, slow: 0, slowTime: 0, pierce: false, homing: false, defaultMode: 0,
    desc: 'Lobbed shells that blast everything in a circle. Great vs swarms.',
  },
  {
    key: 'frost', name: 'Frost', hotkey: '3', cost: 90,
    color: [170, 220, 255], range: 105, rate: 1.4, damage: 4, projSpeed: 420,
    splash: 46, slow: 0.5, slowTime: 1.6, pierce: false, homing: true, defaultMode: 0,
    desc: 'Icy shards slow a whole group by half. Pairs with anything.',
  },
  {
    key: 'sniper', name: 'Sniper', hotkey: '4', cost: 160,
    color: [200, 140, 255], range: 270, rate: 0.55, damage: 75, projSpeed: 1200,
    splash: 0, slow: 0, slowTime: 0, pierce: true, homing: true, defaultMode: 2,
    desc: 'Huge range, ignores armor, hunts the toughest target.',
  },
];

// per level multipliers (level 0 is the base tower, 3 is max)
export const LEVEL_DMG = [1, 1.7, 2.7, 4.2];
export const LEVEL_RATE = [1, 1.12, 1.25, 1.4];
export const LEVEL_RANGE = [1, 1.08, 1.16, 1.25];
export const LEVEL_UP_COST = [1.0, 1.9, 3.4]; // times base cost
export const MAX_LEVEL = 3;

// enemy types
// shape ids match the shader: 0 circle, 1 square, 2 triangle, 3 diamond, 4 hexagon
export const ENEMIES = [
  { key: 'grunt', name: 'Grunt', hp: 32, speed: 48, armor: 0, reward: 4, radius: 7, shape: 0, color: [255, 92, 92], dmg: 1 },
  { key: 'runner', name: 'Runner', hp: 20, speed: 95, armor: 0, reward: 4, radius: 6, shape: 2, color: [255, 214, 80], dmg: 1 },
  { key: 'brute', name: 'Brute', hp: 125, speed: 30, armor: 6, reward: 10, radius: 10, shape: 1, color: [150, 210, 120], dmg: 2 },
  { key: 'swarm', name: 'Swarm', hp: 9, speed: 68, armor: 0, reward: 1, radius: 4.5, shape: 3, color: [255, 128, 220], dmg: 1 },
  { key: 'boss', name: 'Warlord', hp: 1700, speed: 24, armor: 10, reward: 120, radius: 17, shape: 4, color: [190, 110, 255], dmg: 10 },
];

// path waypoints in tile coordinates. path 1 merges into path 0.
export const PATHS = [
  [[-1, 5], [8, 5], [8, 14], [18, 14], [18, 5], [30, 5], [30, 22], [42, 22], [42, 14], [46, 14]],
  [[-1, 25], [14, 25], [14, 19], [24, 19], [24, 26], [36, 26], [36, 22], [42, 22], [42, 14], [46, 14]],
];

export const BASE_TILE = [46, 14];
