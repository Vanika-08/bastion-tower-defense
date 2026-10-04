// perf.js
// Records frame times into fixed buffers (no allocations per frame)
// and turns a recording into the numbers used in NUMBERS.md.

const RING = 240; // frames shown in the graph
const BENCH_CAP = 20000;

export class Perf {
  constructor() {
    this.ring = new Float32Array(RING);
    this.ringIdx = 0;
    this.fps = 0;
    this.frameMs = 0;
    this.simMs = 0;
    this.renderMs = 0;
    this.acc = 0;
    this.accFrames = 0;

    this.bench = null;
    this.bFrame = new Float32Array(BENCH_CAP);
    this.bSim = new Float32Array(BENCH_CAP);
    this.bRender = new Float32Array(BENCH_CAP);
  }

  heapMB() {
    const m = performance.memory;
    return m ? m.usedJSHeapSize / 1048576 : NaN;
  }

  // called once per animation frame with the real time since last frame
  frame(dtMs, simMs, renderMs) {
    this.ring[this.ringIdx] = dtMs;
    this.ringIdx = (this.ringIdx + 1) % RING;
    this.frameMs = dtMs;
    // smooth the cost numbers a bit so they are readable
    this.simMs += (simMs - this.simMs) * 0.1;
    this.renderMs += (renderMs - this.renderMs) * 0.1;
    this.acc += dtMs;
    this.accFrames++;
    if (this.acc >= 500) {
      this.fps = (this.accFrames * 1000) / this.acc;
      this.acc = 0;
      this.accFrames = 0;
    }

    const b = this.bench;
    if (b) {
      b.elapsed += dtMs;
      if (b.elapsed < b.warmup) return;
      if (b.n < BENCH_CAP) {
        this.bFrame[b.n] = dtMs;
        this.bSim[b.n] = simMs;
        this.bRender[b.n] = renderMs;
        b.n++;
      }
      if (b.elapsed >= b.warmup + b.duration) this.finishBench();
    }
  }

  startBench(seconds, label, onDone, getCounts) {
    this.bench = { label, n: 0, elapsed: 0, warmup: 1000, duration: seconds * 1000, onDone, getCounts, heapStart: this.heapMB() };
  }

  finishBench() {
    const b = this.bench;
    this.bench = null;
    const n = b.n;
    const frames = Array.from(this.bFrame.subarray(0, n)).sort((x, y) => x - y);
    let total = 0, ok45 = 0, over33 = 0, sim = 0, ren = 0;
    for (let i = 0; i < n; i++) {
      const f = this.bFrame[i];
      total += f;
      if (f <= 1000 / 45) ok45++;
      if (f > 33.4) over33++;
      sim += this.bSim[i];
      ren += this.bRender[i];
    }
    const counts = b.getCounts();
    const result = {
      label: b.label,
      frames: n,
      avgFps: (n * 1000) / total,
      pct45: (ok45 / n) * 100,
      pct33: (over33 / n) * 100,
      p50: frames[Math.floor(n * 0.5)],
      p95: frames[Math.floor(n * 0.95)],
      p99: frames[Math.floor(n * 0.99)],
      simMs: sim / n,
      renderMs: ren / n,
      heapStart: b.heapStart,
      heapEnd: this.heapMB(),
      ...counts,
    };
    result.pass = result.pct45 >= 95 && result.pct33 < 5;
    if (b.onDone) b.onDone(result);
  }

  static toMarkdownRow(r) {
    const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
    return `| ${r.label} | ${r.enemies} | ${r.towers} | ${r.projectiles} | ${f(r.avgFps)} | ${f(r.pct45)}% | ${f(r.pct33)}% | ${f(r.p95)} | ${f(r.simMs, 2)} | ${f(r.renderMs, 2)} | ${r.pass ? 'pass' : 'fail'} |`;
  }

  // small frame time graph, drawn into a 2d canvas
  drawGraph(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const maxMs = 50;
    // guide lines at 16.7ms (60fps) and 33ms
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, h - (16.7 / maxMs) * h, w, 1);
    ctx.fillStyle = 'rgba(255,120,100,0.25)';
    ctx.fillRect(0, h - (33.3 / maxMs) * h, w, 1);
    const bw = w / RING;
    for (let k = 0; k < RING; k++) {
      const v = this.ring[(this.ringIdx + k) % RING];
      const bh = Math.min(h, (v / maxMs) * h);
      ctx.fillStyle = v > 33.3 ? '#ff6f5e' : v > 22.2 ? '#e8b54a' : '#6fd39b';
      ctx.fillRect(k * bw, h - bh, Math.max(1, bw - 0.5), bh);
    }
  }
}
