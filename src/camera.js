// camera.js
// Simple 2D camera: world -> screen is (world - pos) * zoom.

import { WORLD_W, WORLD_H } from './config.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.viewW = 1;
    this.viewH = 1;
    this.insetTop = 0;
    this.insetBottom = 0;
    this.fitZoom = 1;
    this.maxZoom = 3;
    this.dirty = true;
    this.fitted = false;
  }

  resize(w, h, insetTop, insetBottom) {
    this.viewW = w;
    this.viewH = h;
    this.insetTop = insetTop;
    this.insetBottom = insetBottom;
    const innerH = Math.max(100, h - insetTop - insetBottom);
    this.fitZoom = Math.min((w - 24) / WORLD_W, (innerH - 16) / WORLD_H);
    if (!this.fitted) this.fit();
    this.clamp();
    this.dirty = true;
  }

  fit() {
    this.fitted = true;
    this.zoom = this.fitZoom;
    const innerH = this.viewH - this.insetTop - this.insetBottom;
    this.x = WORLD_W / 2 - this.viewW / 2 / this.zoom;
    this.y = WORLD_H / 2 - (this.insetTop + innerH / 2) / this.zoom;
    this.dirty = true;
  }

  clamp() {
    const minZ = this.fitZoom * 0.85;
    if (this.zoom < minZ) this.zoom = minZ;
    if (this.zoom > this.maxZoom) this.zoom = this.maxZoom;
    const visW = this.viewW / this.zoom;
    const visH = this.viewH / this.zoom;
    const pad = 120;
    this.x = Math.min(Math.max(this.x, -pad - visW / 2), WORLD_W + pad - visW / 2);
    this.y = Math.min(Math.max(this.y, -pad - visH / 2), WORLD_H + pad - visH / 2);
  }

  zoomAt(sx, sy, factor) {
    const wx = this.toWorldX(sx), wy = this.toWorldY(sy);
    this.zoom *= factor;
    this.clamp();
    this.x = wx - sx / this.zoom;
    this.y = wy - sy / this.zoom;
    this.clamp();
    this.dirty = true;
  }

  pan(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
    this.dirty = true;
  }

  toWorldX(sx) { return sx / this.zoom + this.x; }
  toWorldY(sy) { return sy / this.zoom + this.y; }

  // visible world rect, used for culling
  left() { return this.x; }
  top() { return this.y; }
  right() { return this.x + this.viewW / this.zoom; }
  bottom() { return this.y + this.viewH / this.zoom; }
}
