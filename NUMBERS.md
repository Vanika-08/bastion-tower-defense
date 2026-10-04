# Performance Testing Report

## 1. Test environment and interpretation

- **Browser:** Chrome 153 on macOS
- **Device pixel ratio:** 2
- **Display:** ProMotion enabled
- **Chrome Energy Saver:** Disabled during the final test
- **Frame-loop sanity check:** 360 `requestAnimationFrame` frames in 3 seconds, averaging 8.33 ms per frame (approximately 120 FPS)

The browser benchmark uses a 1-second warm-up followed by a 10-second recording period. It passes when both conditions are met:

- At least **95% of frames** are at 45 FPS or higher (frame time at or below 22.2 ms).
- Fewer than **5% of frames** exceed 33.4 ms.

**Interpretation note:** Earlier browser measurements were captured while Chrome's frame loop was constrained to approximately 30 FPS even without a workload. The earlier configuration results are not reliable for optimization comparisons and are omitted from the comparison tables below. Only the final all-optimizations browser result was rerun after the browser issue was resolved.

## 2. Browser full-frame performance

The latest browser stress test used **5,000 enemies, 100 towers, and 1,000 projectiles**, with all optimization toggles enabled. In this run, it averaged **120 FPS**.

| Configuration | Enemies | Towers | Projectiles | Average FPS | Frames at 45+ FPS | Frames over 33.4 ms | p95 frame time (ms) | Simulation (ms) | Render (ms) | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| All optimizations enabled (latest run) | 5,000 | 100 | 1,000 | 120.0 | 100.0% | 0.0% | 9.3 | 0.74 | 0.64 | **PASS** |

The latest result meets both benchmark criteria: 100.0% of frames were at 45 FPS or higher, and 0.0% exceeded 33.4 ms. Browser performance can vary between runs; this latest run supersedes the earlier 71.3 FPS stress-test reading for the current results table.

### Breaking-point testing

Breaking-point testing was performed by increasing workload in steps. The initial configuration (all optimizations disabled) passed through 3,000 enemies / 75 towers / 600 projectiles and failed at 5,000 / 100 / 1,000. The optimized configuration passed all tested loads through the assignment target of 5,000 / 100 / 1,000. No optimized failure was reached, so do not claim a maximum passing load beyond the highest tested workload.

| Configuration | Highest passing load (enemies / towers / projectiles) | First failing load (enemies / towers / projectiles) |
|---|---|---|
| Initial (all optimizations disabled) | 3,000 / 75 / 600 | 5,000 / 100 / 1,000 |
| All optimizations enabled | 5,000 / 100 / 1,000 (highest tested) | Not reached; testing stopped after target passed |

#### Initial configuration — workload progression

| Enemies | Towers | Projectiles | Average FPS | Frames at 45+ FPS | Frames over 33.4 ms | p95 frame time (ms) | Simulation (ms) | Render (ms) | Result |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 500 | 25 | 100 | 120.0 | 100.0% | 0.0% | 9.3 | 0.37 | 0.93 | **PASS** |
| 1,000 | 25 | 200 | 44.1 | 99.8% | 0.2% | 9.2 | 0.59 | 1.33 | **PASS** |
| 2,000 | 50 | 400 | 120.0 | 100.0% | 0.0% | 9.3 | 1.74 | 2.52 | **PASS** |
| 3,000 | 75 | 600 | 55.2 | 99.3% | 0.4% | 16.6 | 4.42 | 3.44 | **PASS** |
| 5,000 | 100 | 1,000 | 4.7 | 0.0% | 100.0% | 99.9 | 79.35 | 7.91 | **FAIL** |

#### All optimizations enabled — workload progression

| Enemies | Towers | Projectiles | Average FPS | Frames at 45+ FPS | Frames over 33.4 ms | p95 frame time (ms) | Simulation (ms) | Render (ms) | Result |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 500 | 25 | 102 | 120.0 | 100.0% | 0.0% | 9.3 | 0.11 | 0.16 | **PASS** |
| 1,000 | 25 | 200 | 93.1 | 99.9% | 0.1% | 9.0 | 0.15 | 0.21 | **PASS** |
| 2,000 | 50 | 400 | 96.1 | 99.9% | 0.1% | 9.0 | 0.36 | 0.51 | **PASS** |
| 3,000 | 75 | 600 | 92.5 | 99.9% | 0.1% | 8.9 | 0.50 | 0.57 | **PASS** |
| 5,000 | 100 | 1,000 | 120.0 | 100.0% | 0.0% | 9.3 | 0.74 | 0.64 | **PASS** |

**Comparison note:** FPS readings are not monotonic as workload rises, likely due to browser/display scheduling and measurement variability. Use the stated pass/fail criteria and workload details rather than interpreting FPS alone as a perfectly linear scaling curve. The 500-load projectile counts differ slightly (100 initial vs. 102 optimized), so that row is not an exact like-for-like comparison.

## 3. Simulation-only performance (`npm run bench`)

The following results were recorded in Node.js 22.16.0 with a workload of 5,000 enemies, 100 towers, and at least 1,000 projectiles. Values may vary slightly with machine load.

| Configuration | Average ms/tick | p95 ms/tick | Speedup vs. initial (average) |
|---|---:|---:|---:|
| Naive (no spatial grid, retarget every tick) | 69.87 | 78.97 | 1.0× |
| Throttled retarget only | 43.09 | 55.52 | 1.6× |
| Spatial grid only | 4.09 | 4.90 | 17.1× |
| Spatial grid + throttled retargeting (final) | 2.08 | 3.04 | 33.6× |

The final simulation averages approximately **2.08 ms per tick**, below the 16.7 ms budget for a 60 Hz simulation. Spatial indexing provides the largest measured improvement; combining it with throttled retargeting reduces tick time further.

**Important:** These are simulation-only benchmark results, not full browser frame times. They should not be compared directly with the browser FPS table.

## 4. Full 50-wave bot runs and heap samples

Both automated gameplay scenarios completed during the recorded local benchmark run.

| Scenario | Final state | Wave reached | Remaining lives | Score | Towers |
|---|---|---:|---:|---:|---:|
| Mixed towers + upgrades | Won | 50 | 30 | 377,057 | 125 |
| Gunners only | Lost | 20 | 0 | 50,340 | 51 |

Heap memory was sampled every five waves during the winning mixed-tower run:

| Wave | 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Heap (MB) | 6.7 | 7.5 | 8.6 | 5.8 | 6.9 | 8.1 | 5.3 | 6.3 | 7.6 | 8.8 |

Heap usage fluctuated during the sample, consistent with garbage collection. This short sample does not show a sustained upward trend, but it is not a substitute for a longer memory soak test.

## 5. Validation status

| Test | Status | Notes |
|---|---|---|
| `npm run bench` | **PASS** | Benchmark output generated; both bot scenarios completed. |
| Simulation performance | **PASS** | Final configuration averaged 2.08 ms/tick. |
| Browser full-frame stress benchmark | **PASS** | Latest target-load run: 120.0 average FPS; 100.0% of frames at 45+ FPS. |
| Browser frame-loop sanity check | **PASS** | Approximately 120 FPS after Chrome Energy Saver was disabled. This is a sanity check, not the stress-test FPS. |
| Breaking-point testing | **PARTIALLY COMPLETE** | Initial config first failed at 5,000 / 100 / 1,000; all-optimizations config passed the target load, and no higher optimized failure was tested. |
| Production build | **PASS in an earlier local run; not rerun successfully in the review environment** | The earlier `npm run build` completed successfully with Vite 5.4.21. In the review environment, dependency installation timed out and Vite was unavailable. Re-run `npm ci` followed by `npm run build` before submission if the source has changed since that successful build. |
| Deployment | **Not independently verified during this benchmark run** | Live demo URL: <https://bastion-tower-defense.onrender.com/>. A URL being available does not by itself verify the deployed build's current behavior. |

## 6. Reproduction commands

Run these from the project root after dependencies install successfully:

```bash
npm ci
npm run build
npm run bench
```

For browser stress and breaking-point tests, open the app in Chrome, disable Chrome Energy Saver, keep the browser/window size consistent, use a 1-second warm-up and 10-second recording, and record the in-game performance panel for each workload and toggle configuration.

## Conclusion

The recorded simulation benchmark and latest browser stress benchmark passed their stated criteria. The simulation averaged 2.08 ms per tick, and the latest browser stress test averaged 120.0 FPS with 100.0% of frames at 45 FPS or higher at 5,000 enemies / 100 towers / 1,000 projectiles. Breaking-point testing is complete for the initial configuration and partially complete for the optimized configuration: the initial setup failed at the target load, while the optimized setup passed it. The optimized first failing load remains unknown because higher loads were not tested.
