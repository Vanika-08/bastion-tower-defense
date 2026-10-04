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

The final browser stress test used **5,000 enemies, 100 towers, and 1,000 projectiles**, with all optimization toggles enabled.

| Configuration | Enemies | Towers | Projectiles | Average FPS | Frames at 45+ FPS | Frames over 33.4 ms | p95 frame time (ms) | Simulation (ms) | Render (ms) | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| All optimizations enabled (final, after browser fix) | 5,000 | 100 | 1,000 | 71.3 | 99.9% | 0.1% | 9.2 | 0.79 | 0.69 | **PASS** |

The final result meets both benchmark criteria: 99.9% of frames were at 45 FPS or higher, and 0.1% exceeded 33.4 ms.

### Breaking-point testing

Breaking-point testing has **not yet been measured reliably** after the browser frame-rate issue was corrected. No maximum passing load or first failing load is claimed here. To complete this test, increase one workload dimension at a time under the corrected browser setup and record both the highest passing load and the first failing load.

| Configuration | Highest passing load | First failing load |
|---|---|---|
| Initial (all optimizations disabled) | Not measured after browser fix | Not measured after browser fix |
| All optimizations enabled | Not measured after browser fix | Not measured after browser fix |

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
| Browser full-frame stress benchmark | **PASS** | 71.3 average FPS; 99.9% of frames at 45+ FPS. |
| Browser frame-loop sanity check | **PASS** | Approximately 120 FPS after Chrome Energy Saver was disabled. This is a sanity check, not the stress-test FPS. |
| Breaking-point testing | **PENDING** | Must be rerun in the corrected browser environment. |
| Production build | **PASS in an earlier local run; not rerun successfully in the review environment** | The earlier `npm run build` completed successfully with Vite 5.4.21. In the review environment, dependency installation timed out and Vite was unavailable. Re-run `npm ci` followed by `npm run build` before submission if the source has changed since that successful build. |
| Deployment | **Not independently verified during this benchmark run** | Live demo URL: <https://bastion-tower-defense.onrender.com/>. A URL being available does not by itself verify the deployed build's current behavior. |

## 6. Reproduction commands

Run these from the project root after dependencies install successfully:

```bash
npm ci
npm run build
npm run bench
```

For the browser stress test, open the app in Chrome, disable Chrome Energy Saver, enable all optimization toggles, set the workload to 5,000 enemies, 100 towers, and 1,000 projectiles, then record the in-game performance panel after its warm-up.

## Conclusion

The recorded simulation benchmark and final browser stress benchmark passed their stated criteria. The simulation averaged 2.08 ms per tick, and the browser stress test averaged 71.3 FPS with 99.9% of frames at 45 FPS or higher. Breaking-point testing remains pending. The earlier browser toggle readings are excluded from optimization comparisons because they were collected in an inconsistent browser frame-rate environment.
