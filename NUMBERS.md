# Performance Testing Report

## 1. Test Environment and Interpretation

- **Browser:** Chrome 153 on macOS
- **User Agent:** macOS (Mac user agent)
- **Device Pixel Ratio:** 2
- **Display:** ProMotion enabled
- **Chrome Energy Saver:** Disabled during the final test

### Browser Frame-Loop Sanity Check

After correcting the browser environment, an independent `requestAnimationFrame` test recorded:

- **Frames:** 360 in 3 seconds
- **Average frame interval:** 8.33 ms
- **Approximate frame rate:** 120 FPS

### Browser Benchmark Pass Criteria

The benchmark passes when both conditions are satisfied:

- At least **95% of frames** run at 45 FPS or higher (frame time ≤ 22.2 ms).
- Fewer than **5% of frames** exceed 33.4 ms.

**Important:** Earlier browser measurements were recorded while Chrome was delivering approximately 30 FPS, even without a workload. These results are retained for diagnostic purposes only and should not be used for fair optimization comparisons. Only the final all-optimizations configuration was rerun after the browser frame-rate issue was resolved.

---

## 2. Browser Full-Frame Performance

The in-game benchmark uses a 1-second warm-up followed by a 10-second recording period.

The final result was recorded with **5,000 enemies, 100 towers, and 1,000 projectiles**, with all optimization toggles enabled.

### Final Browser Benchmark

| Configuration | Enemies | Towers | Shots | Avg FPS | Frames ≥ 45 FPS | Frames > 33 ms | p95 (ms) | Sim (ms) | Render (ms) | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| All optimizations (final, after browser fix) | 5,000 | 100 | 1,000 | 71.3 | 99.9% | 0.1% | 9.2 | 0.79 | 0.69 | **PASS** |

### Earlier Browser Readings — Diagnostic Only

These measurements were taken while the browser was delivering approximately 30 FPS. Chrome Energy Saver was subsequently disabled, and the independent frame-loop test measured 120 FPS.

The earlier readings are included to preserve debugging history, not as reliable optimization comparisons.

| Configuration | Enemies | Towers | Shots | Avg FPS | Frames ≥ 45 FPS | Frames > 33 ms | p95 (ms) | Sim (ms) | Render (ms) | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Initial (all off, pre-fix) | 5,000 | 100 | 1,000 | 2.1 | 0.0% | 100.0% | 233.9 | 192.96 | 9.45 | FAIL |
| Spatial grid only (pre-fix) | 5,000 | 100 | 1,000 | 9.0 | 0.0% | 40.0% | 33.5 | 4.52 | 8.26 | FAIL |
| Throttled retarget only (pre-fix) | 5,000 | 100 | 1,000 | 8.7 | 0.0% | 100.0% | 133.7 | 105.32 | 7.84 | FAIL |
| WebGL instanced renderer only (pre-fix) | 5,000 | 100 | 1,000 | 5.2 | 0.0% | 100.0% | 200.1 | 189.70 | 0.52 | FAIL |
| Viewport culling only (pre-fix) | 5,000 | 100 | 1,000 | 5.0 | 0.0% | 100.0% | 233.3 | 188.13 | 7.84 | FAIL |
| All optimizations (pre-fix) | 5,000 | 100 | 1,000 | 118.8 | 99.9% | 0.0% | 9.3 | 0.95 | 0.68 | PASS |

---

## 3. Breaking-Point Testing

Breaking-point tests have not yet been measured reliably after correcting the browser's approximately 30 FPS behavior.

Previous low-load tests were captured in the affected environment and are not considered valid breaking-point results.

These tests should be rerun using the final browser setup, increasing one workload dimension at a time and recording the highest passing load and the first failing load.

| Configuration | Highest Passing Load | First Failing Load |
|---|---|---|
| Initial (all optimizations off) | Not measured after browser fix | Not measured after browser fix |
| All optimizations enabled | Not measured after browser fix | Not measured after browser fix |

---

## 4. Simulation-Only Performance (`npm run bench`)

**Test environment:** Node.js 22.16.0  
**Workload:** 5,000 enemies, 100 towers, and at least 1,000 projectiles.

The following results were recorded during the final review. Values may vary slightly between runs due to machine load.

| Configuration | Average ms/tick | p95 ms/tick | Speedup vs. Initial |
|---|---:|---:|---:|
| Naive (no grid, retarget every tick) | 69.87 | 78.97 | 1.0× |
| Throttled retarget only | 43.09 | 55.52 | 1.6× |
| Spatial grid only | 4.09 | 4.90 | 17.1× |
| Grid + throttle (final) | 2.08 | 3.04 | 33.6× |

### Simulation Performance Analysis

The final simulation averages approximately **2.08 ms per tick**, comfortably below the **16.7 ms budget** of a 60 Hz simulation.

Spatial indexing provides the largest performance improvement. Combining it with throttled retargeting further reduces the average tick cost.

---

## 5. Full 50-Wave Bot Runs

Both automated gameplay scenarios completed during the latest local benchmark run.

| Scenario | Final State | Wave Reached | Remaining Lives | Score | Towers |
|---|---|---:|---:|---:|---:|
| Mixed towers + upgrades | Won | 50 | 30 | 377,057 | 125 |
| Gunners only | Lost | 20 | 0 | 50,340 | 51 |

The mixed-tower strategy completed all 50 waves with 30 lives remaining. The gunners-only strategy lost at wave 20.

### Heap Usage During the Winning Run

Heap memory was sampled every five waves during the mixed-tower run.

| Wave | 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Heap (MB) | 6.7 | 7.5 | 8.6 | 5.8 | 6.9 | 8.1 | 5.3 | 6.3 | 7.6 | 8.8 |

Heap usage fluctuates as expected due to garbage collection. No sustained upward trend is evident in this sample.

---

## 6. Validation Status

| Test | Status | Notes |
|---|---|---|
| `npm run bench` | **PASS** | Benchmark output generated; both bot scenarios completed |
| Simulation performance | **PASS** | Final average of 2.08 ms/tick |
| Browser full-frame benchmark | **PASS** | 71.3 average FPS; 99.9% of frames at 45+ FPS |
| Browser frame-loop sanity check | **PASS** | Approximately 120 FPS after disabling Chrome Energy Saver |
| Breaking-point testing | **PENDING** | Needs rerun in the corrected browser environment |
| `npm run build` | **NOT VERIFIED** | Dependency installation timed out and Vite was unavailable (`sh: vite: not found`) |
| Deployment | **NOT VERIFIED** | Not tested during this review |

### Build Verification Instructions

To verify the production build before submission, run:

```bash
npm ci
npm run build
```

Ensure dependency installation completes successfully before running the build command.

### Final Conclusion

The simulation benchmark and final browser stress benchmark passed their defined performance criteria. The final simulation averages 2.08 ms per tick, and the browser benchmark achieved 71.3 FPS with 99.9% of frames at 45 FPS or higher.

Breaking-point testing remains pending. The production build and deployment have not been verified in this review environment, so they should not be reported as completed.
