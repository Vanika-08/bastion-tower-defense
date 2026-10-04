# Bastion Tower Defense

A browser-based tower defense game built with plain JavaScript ES
modules, WebGL2, Canvas2D, and Vite. Defend the keep through 50
increasingly difficult waves by placing, upgrading, and selling towers.

- **Live demo:** <https://bastion-tower-defense.onrender.com/>
- **Source code:** <https://github.com/Vanika-08/bastion-tower-defense>

## Features

- 50 progressive waves with five enemy types: Grunt, Runner, Brute,
  Swarm, and Warlord bosses.
- Four tower types, each with four upgrade levels: Gunner, Cannon,
  Frost, and Sniper.
- Tower placement, upgrades, selling with a 70% refund, targeting modes,
  and wave-call bonuses.
- Pause, 1×/2×/3× speed, restart, camera pan/zoom, and a live
  performance panel.
- Fixed-timestep simulation, pooled entity storage, spatial-grid
  queries, and an instanced WebGL2 renderer.
- Headless simulation benchmarks and automated bot runs for balance and
  performance checks.

## Run locally

**Requirements:** Node.js 18 or newer and npm.

``` bash
npm ci
npm run dev
```

Vite prints the local development URL, usually `http://localhost:5173`.

Useful commands:

``` bash
npm run build    # Production build in dist/
npm run preview  # Serve the production build locally
npm run bench    # Headless simulation benchmark and 50-wave bot scenarios
```

## Controls

| Input                                    | Action                                           |
|------------------------------------------|--------------------------------------------------|
| `1`–`4` or click a tower card            | Select Gunner, Cannon, Frost, or Sniper          |
| Left-click grass                         | Place a tower                                    |
| Right-click or `Esc`                     | Cancel build mode or clear selection             |
| Click a placed tower                     | Inspect it                                       |
| `U`                                      | Upgrade selected tower                           |
| `X`                                      | Sell selected tower (70% refund)                 |
| `T`                                      | Cycle targeting mode                             |
| `N`                                      | Start the next wave or call it early for a bonus |
| `Space`                                  | Pause/resume                                     |
| `F`                                      | Cycle 1×, 2×, and 3× speed                       |
| `R`                                      | Restart                                          |
| Mouse wheel, drag, `WASD`, or arrow keys | Zoom and pan                                     |
| `0`                                      | Reset camera view                                |
| `P`                                      | Open the performance panel                       |

## Game design

### Towers

| Tower  | Role                                    | Design intent                                                      |
|--------|-----------------------------------------|--------------------------------------------------------------------|
| Gunner | Cheap, fast single-target damage        | Reliable early-game defense, but small hits struggle against armor |
| Cannon | Lobbed shell with area damage           | Handles groups; shells damage enemies around their landing point   |
| Frost  | Area slow plus light damage             | Slows enemies to improve the effectiveness of other towers         |
| Sniper | Long range, high damage, armor piercing | Deals with Brutes and Warlord bosses                               |

Each tower has four levels.

### Enemies and difficulty

- **Grunt:** Baseline enemy.
- **Runner:** Fast and fragile.
- **Brute:** Slower, with stronger armor.
- **Swarm:** Small enemies that arrive in groups.
- **Warlord:** Heavily armored boss that appears every ten waves and
  costs ten lives if it escapes.

Enemy HP scales with `1 + 0.16k + 0.0085k²`, where `k = wave - 1`. Armor
increases every eight waves, group sizes grow, and spawn gaps shrink.
Additional enemy types unlock on waves 3, 5, and 7; bosses appear on
waves 10, 20, 30, 40, and 50.

Kill rewards increase by 1.2% per wave. Clearing a wave grants
`20 + 3 × wave`, and calling a wave early grants a bonus. Selling a
tower returns 70% of its cost.

The map has two paths that merge, encouraging players to defend separate
approaches early and build a stronger defense around the later choke
point.

## Architecture

``` text
src/
  config.js             Tunable tower, enemy, map, and capacity values
  map.js                Tile grid, path geometry, distance-to-path field
  waves.js              Wave composition and scaling
  grid.js               Uniform spatial hash and nearby-entity queries
  sim.js                Simulation logic; independent of the DOM
  camera.js             Pan/zoom and visible-world bounds
  render/
    webgl.js             Instanced WebGL2 entity renderer
    canvas.js            Canvas2D renderer retained for comparison
    background.js        Cached offscreen map rendering
  perf.js                Frame-time buffer and benchmark recorder
  ui.js                  HUD, tower inspector, and performance panel
  main.js                Game loop, input, and overlays
bench/
  sim-bench.mjs           Headless benchmark and balance bots
```

### Simulation model

- A single `requestAnimationFrame` loop drives the game.
- Simulation advances at a fixed 1/60-second timestep using an
  accumulator; rendering interpolates between simulation states.
- Catch-up work is capped at `2 × speed + 2` ticks per frame to prevent
  overloaded frames from creating a runaway backlog.
- Enemies, towers, projectiles, and effects use struct-of-arrays storage
  backed by typed arrays, free lists, and generation counters. This
  avoids frequent entity-object allocation and prevents projectiles from
  accidentally following a reused target slot.
- Entity storage is preallocated with capacities of 12,000 enemies,
  8,000 projectiles, and 6,000 effects.
- `sim.js` has no DOM dependency and emits events for kills, leaks,
  waves, and victory, allowing the same simulation to run in Node.js for
  headless benchmarks.

### Rendering

The game uses three stacked canvases:

1.  **Cached background Canvas2D:** The map and scenery are drawn to an
    offscreen canvas and reused.
2.  **WebGL2 entities:** Towers, enemies, health bars, projectiles, and
    effects are packed into a preallocated instance buffer and rendered
    with instancing.
3.  **Canvas2D overlay:** Build previews, range circles, floating
    rewards, and pause/visual effects.

The DOM is reserved for the HUD and panels rather than individual game
entities.

## Performance work

### Main bottlenecks identified

1.  **Projectile collision:** Checking every projectile against every
    enemy scales with projectiles × enemies.
2.  **Tower targeting:** Repeatedly scanning all enemies and
    allocating/sorting target lists adds CPU work and garbage
    collection.
3.  **Per-entity Canvas2D rendering:** Many path, fill, stroke, and
    color operations become expensive at high entity counts.
4.  **Off-screen entities:** Processing objects outside the camera view
    wastes rendering work.
5.  **Frequent HUD updates:** Writing UI values every frame creates
    unnecessary DOM work.

### Optimizations implemented

| Optimization          | Implementation                                                                                                                                           |
|-----------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| Spatial hash          | 32-pixel cells; a counting-sort-style rebuild into flat `Int32Array` storage. Collision, splash, and targeting queries inspect nearby cells.             |
| Throttled retargeting | Towers keep a valid target and re-scan about 10 times per second instead of every simulation tick. Target selection avoids temporary arrays and sorting. |
| Instanced WebGL2      | Entity visuals are batched into a preallocated buffer and drawn with instancing.                                                                         |
| Viewport culling      | Entities outside the camera view plus a margin are skipped before being added to the render buffer.                                                      |
| HUD throttling        | HUD refreshes at 10 Hz and only updates text when values change.                                                                                         |
| Always-on foundations | Struct-of-arrays storage, free lists, cached background, fixed timestep, and a catch-up cap.                                                             |

The performance panel (`P`) can record a 10-second browser sample after
a 1-second warm-up. It reports FPS, frame-time percentiles, the share of
frames at 45+ FPS, frames over 33 ms, simulation/render time, entity
counts, and heap information where the browser exposes it. The target is
at least 95% of frames at 45+ FPS and fewer than 5% of frames over 33
ms.

## Benchmark results

Results depend on hardware, browser, power settings, and scene
composition. See [NUMBERS.md](./NUMBERS.md) for the detailed environment
notes, tables, and limitations.

### Headless simulation benchmark

Stress scenario: 5,000 enemies and 100 towers, with at least 1,000
projectiles.

| Configuration                               | Average ms/tick | P95 ms/tick | Speedup vs. naive |
|---------------------------------------------|----------------:|------------:|------------------:|
| Naive: no spatial grid, retarget every tick |           69.87 |       78.97 |              1.0× |
| Throttled retarget only                     |           43.09 |       55.52 |              1.6× |
| Spatial grid only                           |            4.09 |        4.90 |             17.1× |
| Spatial grid + throttled retargeting        |            2.08 |        3.04 |             33.6× |

### Browser stress test

With all optimizations enabled, the recorded run used 5,000 enemies, 100
towers, and 1,000 projectiles.

| Metric                  |   Result |
|-------------------------|---------:|
| Average FPS             |     71.3 |
| Frames at 45+ FPS       |    99.9% |
| Frames over 33 ms       |     0.1% |
| P95 frame time          |   9.2 ms |
| Average simulation time |  0.79 ms |
| Average render time     |  0.69 ms |
| Result                  | **PASS** |

An independent browser frame-loop sanity check measured approximately
120 FPS with Chrome Energy Saver disabled. That is a display/browser
check, not the stress-test FPS result.

**Comparison limitation:** Earlier browser toggle measurements were
recorded while the browser itself was limited to about 30 FPS, so they
are not a fair before/after comparison. The detailed numbers file labels
those rows as diagnostic only. A reliable browser breaking-point
comparison has not yet been measured after correcting the browser
frame-rate issue.

### Balance and memory checks

- Mixed tower types with upgrades: bot won wave 50 with 30 lives
  remaining; score 377,057 and 125 towers.
- Gunner-only bot: lost on wave 20 with 0 lives; score 50,340 and 51
  towers.
- Heap samples during the mixed-tower run ranged from approximately 5.3
  MB to 8.8 MB at five-wave intervals, with normal garbage-collection
  fluctuations and no sustained upward trend in that sample.

## Deployment

The live build is hosted at
[bastion-tower-defense.onrender.com](https://bastion-tower-defense.onrender.com/).

For another static host, build with `npm run build` and publish the
`dist/` directory. Configure the host to use `npm run build` as the
build command and `dist` as the publish/output directory.

## Possible next steps

- Move simulation work to a Web Worker to reduce main-thread contention
  at extreme loads.
- Add sound effects, more maps, and additional tower interactions such
  as chain attacks.
- Repeat browser breaking-point tests on a documented machine/browser
  setup and add automated browser regression tests.
