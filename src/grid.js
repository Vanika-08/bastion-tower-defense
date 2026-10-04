// grid.js
// Uniform spatial grid rebuilt every tick with a counting sort.
// No allocations after construction.

export class SpatialGrid {
  constructor(worldW, worldH, cellSize, capacity) {
    this.cell = cellSize;
    this.inv = 1 / cellSize;
    // one extra ring of cells so enemies just off the map still fit
    this.cols = Math.ceil(worldW / cellSize) + 2;
    this.rows = Math.ceil(worldH / cellSize) + 2;
    const n = this.cols * this.rows;
    this.start = new Int32Array(n + 1);
    this.cursor = new Int32Array(n);
    this.items = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
    this.out = new Int32Array(capacity); // query results go here
  }

  cx(x) {
    let c = Math.floor(x * this.inv) + 1;
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  cy(y) {
    let r = Math.floor(y * this.inv) + 1;
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  // put every alive enemy into its cell
  build(E) {
    const { start, cursor, items, cellOf, cols } = this;
    const n = cols * this.rows;
    start.fill(0);
    const hi = E.hi, alive = E.alive, ex = E.x, ey = E.y;
    // count per cell (stored in start[c + 1])
    for (let i = 0; i < hi; i++) {
      if (!alive[i]) continue;
      const c = this.cy(ey[i]) * cols + this.cx(ex[i]);
      cellOf[i] = c;
      start[c + 1]++;
    }
    // prefix sum
    for (let c = 0; c < n; c++) {
      start[c + 1] += start[c];
      cursor[c] = start[c];
    }
    // fill
    for (let i = 0; i < hi; i++) {
      if (!alive[i]) continue;
      items[cursor[cellOf[i]]++] = i;
    }
  }

  // collect candidates in a box around (x, y). returns count in this.out
  query(x, y, r) {
    const { start, items, out, cols } = this;
    const c0 = this.cx(x - r), c1 = this.cx(x + r);
    const r0 = this.cy(y - r), r1 = this.cy(y + r);
    let k = 0;
    for (let row = r0; row <= r1; row++) {
      const base = row * cols;
      for (let col = c0; col <= c1; col++) {
        const c = base + col;
        for (let j = start[c], e = start[c + 1]; j < e; j++) out[k++] = items[j];
      }
    }
    return k;
  }
}
