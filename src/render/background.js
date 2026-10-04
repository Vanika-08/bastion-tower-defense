// background.js
// The map never changes, so it is painted once into an offscreen canvas.
// Each frame we only blit that image, and only when the camera moved.

import { TILE, COLS, ROWS, WORLD_W, WORLD_H, PATHS, BASE_TILE } from '../config.js';
import { T_ROCK, T_TREE, makeRng } from '../map.js';

const SCALE = 2; // paint at 2x so zooming in stays sharp

export class Background {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.image = document.createElement('canvas');
    this.image.width = WORLD_W * SCALE;
    this.image.height = WORLD_H * SCALE;
    this.paint(map);
  }

  paint(map) {
    const g = this.image.getContext('2d');
    g.scale(SCALE, SCALE);
    const rng = makeRng(7);

    // grass with a soft checker so tiles are readable
    g.fillStyle = '#29483a';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if ((r + c) % 2 === 0) {
          g.fillStyle = 'rgba(255,255,255,0.025)';
          g.fillRect(c * TILE, r * TILE, TILE, TILE);
        }
      }
    }
    // grass tufts
    for (let k = 0; k < 900; k++) {
      const x = rng() * WORLD_W, y = rng() * WORLD_H;
      g.fillStyle = rng() < 0.5 ? 'rgba(120,170,110,0.18)' : 'rgba(10,30,20,0.18)';
      g.fillRect(x, y, 2, 2);
    }

    // path: dark edge, sand fill, worn center line
    const strokePaths = (width, style) => {
      g.lineWidth = width;
      g.strokeStyle = style;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      for (const pts of PATHS) {
        g.beginPath();
        pts.forEach(([c, r], i) => {
          const x = (c + 0.5) * TILE, y = (r + 0.5) * TILE;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        });
        g.stroke();
      }
    };
    strokePaths(TILE + 6, '#5e4730');
    strokePaths(TILE - 2, '#b8915e');
    strokePaths(TILE - 14, '#c7a26f');
    g.setLineDash([6, 10]);
    strokePaths(2, 'rgba(90,65,40,0.35)');
    g.setLineDash([]);

    // rocks and trees
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = map.tiles[r * COLS + c];
        const x = (c + 0.5) * TILE, y = (r + 0.5) * TILE;
        if (t === T_TREE) {
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.beginPath(); g.ellipse(x + 3, y + 6, 11, 6, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#1b3a2a';
          g.beginPath(); g.arc(x - 4, y + 1, 9, 0, Math.PI * 2); g.arc(x + 5, y - 1, 9, 0, Math.PI * 2); g.arc(x, y - 6, 9, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#2f5c40';
          g.beginPath(); g.arc(x - 2, y - 6, 5, 0, Math.PI * 2); g.fill();
        } else if (t === T_ROCK) {
          g.fillStyle = 'rgba(0,0,0,0.22)';
          g.beginPath(); g.ellipse(x + 2, y + 6, 10, 5, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#7c8580';
          g.beginPath();
          g.moveTo(x - 10, y + 5); g.lineTo(x - 6, y - 6); g.lineTo(x + 4, y - 8); g.lineTo(x + 10, y + 1); g.lineTo(x + 5, y + 7);
          g.closePath(); g.fill();
          g.fillStyle = '#9aa39d';
          g.beginPath(); g.moveTo(x - 6, y - 6); g.lineTo(x + 4, y - 8); g.lineTo(x + 1, y - 2); g.closePath(); g.fill();
        }
      }
    }

    // spawn gates on the left edge
    for (const pts of PATHS) {
      const y = (pts[0][1] + 0.5) * TILE;
      const grd = g.createRadialGradient(0, y, 2, 0, y, 40);
      grd.addColorStop(0, 'rgba(255,110,90,0.55)');
      grd.addColorStop(1, 'rgba(255,110,90,0)');
      g.fillStyle = grd;
      g.fillRect(0, y - 40, 40, 80);
    }

    // the keep the player defends
    const bx = (BASE_TILE[0] + 0.5) * TILE, by = (BASE_TILE[1] + 0.5) * TILE;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath(); g.ellipse(bx + 4, by + 30, 46, 14, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#58615d';
    g.fillRect(bx - 38, by - 30, 76, 62);
    g.fillStyle = '#6f7a75';
    for (let k = 0; k < 5; k++) g.fillRect(bx - 38 + k * 17, by - 40, 10, 12);
    g.fillStyle = '#3a2a1e';
    g.beginPath(); g.moveTo(bx - 11, by + 32); g.lineTo(bx - 11, by + 8); g.arc(bx, by + 8, 11, Math.PI, 0); g.lineTo(bx + 11, by + 32); g.fill();
    g.fillStyle = '#e8b54a';
    g.fillRect(bx - 1, by - 66, 2, 28);
    g.beginPath(); g.moveTo(bx + 1, by - 66); g.lineTo(bx + 20, by - 60); g.lineTo(bx + 1, by - 54); g.fill();
  }

  draw(cam, dpr) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#16261f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const z = cam.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.image, 0, 0, WORLD_W, WORLD_H);
  }

  resize(w, h, dpr) {
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }
}
