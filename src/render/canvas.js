// canvas.js
// The first renderer: plain Canvas2D, one path + fill per entity,
// a new color string per entity, save/restore for rotation.
// Kept in the project so the before/after can be shown live.

import { TOWERS, ENEMIES } from '../config.js';

export function drawNaive(ctx, game, cam, alpha, cull) {
  const m = 30;
  const L = cam.left() - m, R = cam.right() + m, Tp = cam.top() - m, Bt = cam.bottom() + m;
  const visible = (x, y) => !cull || (x > L && x < R && y > Tp && y < Bt);
  let drawn = 0;

  // towers
  const T = game.T;
  for (let t = 0; t < T.hi; t++) {
    if (!T.alive[t]) continue;
    if (!visible(T.x[t], T.y[t])) continue;
    const def = TOWERS[T.type[t]];
    const [r, g, b] = def.color;
    ctx.fillStyle = 'rgb(28, 44, 40)';
    ctx.fillRect(T.x[t] - 13, T.y[t] - 13, 26, 26);
    ctx.save();
    ctx.translate(T.x[t], T.y[t]);
    ctx.rotate(T.angle[t]);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, -3, 16, 6);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(T.x[t], T.y[t], 8, 0, Math.PI * 2);
    ctx.fill();
    drawn++;
  }

  // enemies with health bars
  const E = game.E;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i]) continue;
    const x = E.px[i] + (E.x[i] - E.px[i]) * alpha;
    const y = E.py[i] + (E.y[i] - E.py[i]) * alpha;
    if (!visible(x, y)) continue;
    const def = ENEMIES[E.type[i]];
    const [r, g, b] = def.color;
    const rad = E.radius[i];
    ctx.fillStyle = E.flash[i] > 0 ? '#ffffff' : `rgb(${r}, ${g}, ${b})`;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (E.hp[i] < E.maxHp[i]) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(x - rad, y - rad - 7, rad * 2, 3);
      ctx.fillStyle = 'rgb(90, 240, 120)';
      ctx.fillRect(x - rad, y - rad - 7, rad * 2 * (E.hp[i] / E.maxHp[i]), 3);
    }
    drawn++;
  }

  // projectiles
  const P = game.P;
  for (let p = 0; p < P.hi; p++) {
    if (!P.alive[p]) continue;
    const x = P.px[p] + (P.x[p] - P.px[p]) * alpha;
    const y = P.py[p] + (P.y[p] - P.py[p]) * alpha;
    if (!visible(x, y)) continue;
    const [r, g, b] = TOWERS[P.kind[p]].color;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.35)`;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    drawn++;
  }

  // effects
  const F = game.F;
  for (let i = 0; i < F.hi; i++) {
    if (!F.alive[i]) continue;
    if (!visible(F.x[i], F.y[i])) continue;
    const c = F.color[i];
    const t = F.life[i] / F.max[i];
    ctx.globalAlpha = t;
    ctx.fillStyle = `rgb(${c & 255}, ${(c >>> 8) & 255}, ${(c >>> 16) & 255})`;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    if (F.kind[i] === 1) {
      ctx.lineWidth = 2;
      ctx.arc(F.x[i], F.y[i], F.size[i] * (1.1 - t * 0.6), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.arc(F.x[i], F.y[i], F.size[i], 0, Math.PI * 2);
      ctx.fill();
    }
    drawn++;
  }
  ctx.globalAlpha = 1;
  return drawn;
}
