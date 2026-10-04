// waves.js
// Builds the spawn groups for each of the 50 waves.

// enemies get tougher each wave
export function hpMult(n) {
  const k = n - 1;
  return 1 + 0.16 * k + 0.0085 * k * k;
}

// armor grows slowly so gunners fall off late
export function armorBonus(n) {
  return Math.floor(n / 8);
}

// gold per kill grows a little so the economy keeps up
export function rewardMult(n) {
  return 1 + 0.012 * n;
}

// each group: type, count, seconds between spawns, start delay, which path
export function buildWave(n) {
  const groups = [];
  const iv = Math.max(0.2, 0.85 - n * 0.012);

  groups.push({ type: 0, count: 6 + Math.floor(n * 1.6), interval: iv, delay: 0, path: n % 2 });

  if (n >= 3) {
    groups.push({ type: 1, count: 3 + Math.floor(n * 0.9), interval: iv * 0.7, delay: 2.5, path: (n + 1) % 2 });
  }
  if (n >= 5 && n % 2 === 1) {
    groups.push({ type: 3, count: 14 + n * 2, interval: 0.07, delay: 4, path: (n >> 1) % 2 });
  }
  if (n >= 7) {
    groups.push({ type: 2, count: 1 + Math.floor((n - 5) / 3), interval: 1.7, delay: 3, path: n % 2 });
  }
  if (n % 10 === 0) {
    groups.push({ type: 4, count: n / 10, interval: 5, delay: 6, path: 0 });
  }
  return groups;
}

// short text for the "next wave" preview
export function describeWave(n, enemyDefs) {
  return buildWave(n).map((g) => `${g.count} ${enemyDefs[g.type].name}`).join(', ');
}
