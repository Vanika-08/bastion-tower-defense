# Bastion, a browser tower defense

Hold the keep for 50 waves. Build towers on the grass, upgrade the ones that work, sell the ones that do not.

No backend, no external services, no runtime dependencies. Plain JavaScript (ES modules), WebGL2 and Canvas2D, bundled with Vite.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the build
npm run bench      # headless simulation benchmark + 50 wave bot run (node 18+)
```

Deploy: push to GitHub and import into Vercel or Netlify. Both detect Vite. Build command `npm run build`, output folder `dist`. A `netlify.toml` is included.

## How to play

| Input | Action |
| --- | --- |
| `1` to `4` or click a card | Pick Gunner, Cannon, Frost, Sniper |
| Left click on grass | Build (stays in build mode while you can afford more) |
| Right click or `Esc` | Stop building, clear selection |
| Click a tower | Inspect it |
| `U` / `X` / `T` | Upgrade / sell (70% refund) / cycle targeting |
| `N` | Start or call the next wave early (bonus gold) |
| `Space` / `F` / `R` | Pause / cycle speed 1x 2x 3x / restart |
| Scroll, drag, WASD or arrows | Zoom and pan. `0` resets the view |
| `P` | Performance panel |

## Game design decisions

**Towers** (each has 4 levels):

| Tower | Role | Why it exists |
| --- | --- | --- |
| Gunner | Fast single target, cheap | Early game backbone. Flat armor cuts each small bullet, so it falls off late |
| Cannon | Lobbed shell, area blast, leads its target | Answers Swarm groups. Shells fly over enemies and only hit where they land |
| Frost | Area slow (50%) plus chip damage | Force multiplier for every other tower |
| Sniper | Huge range, ignores armor, targets the strongest | Answers Brutes and the Warlord boss |

**Enemies**: Grunt (baseline), Runner (fast, fragile), Brute (slow, armored), Swarm (tiny, comes in packs of 20 to 110), Warlord (boss every 10 waves, heavy armor, costs 10 lives).

**Difficulty curve**: HP scales by `1 + 0.16k + 0.0085k²` (k = wave − 1), so wave 50 enemies have roughly 29x the HP of wave 1. Armor grows by 1 every 8 waves. Group sizes grow linearly and spawn gaps shrink. New enemy types unlock at waves 3, 5 and 7, bosses arrive at 10, 20, 30, 40 and 50.

**Economy**: kill rewards grow slowly (1.2% per wave), a clear bonus of `20 + 3 × wave`, and a bonus for calling waves early. Selling refunds 70%.

**Balance check**: `npm run bench` plays the full game headless with two bots. A bot that mixes tower types and upgrades wins all 50 waves. A bot that only builds Gunners dies on wave 20. So the curve rewards using the tower roles, which was the goal. The curve was tuned by sweeping the HP formula with these bots.

**Two paths that merge** so the player has to split early defenses and then gets a strong choke point near the keep.

## Architecture

```
src/
  config.js            all tunable numbers (towers, enemies, map, limits)
  map.js               tile grid, path geometry, distance-to-path field
  waves.js             wave composition and scaling formulas
  grid.js              uniform spatial hash (counting sort, no allocations)
  sim.js               the whole simulation, no DOM, also runs in node
  camera.js            pan / zoom, visible world rect
  render/webgl.js      instanced WebGL2 renderer (final)
  render/canvas.js     per-entity Canvas2D renderer (initial version, kept for comparison)
  render/background.js map painted once into an offscreen canvas
  perf.js              frame time ring buffer, 10 s benchmark recorder
  ui.js                HUD, inspector, perf panel (DOM)
  main.js              the single game loop, input, overlay
bench/sim-bench.mjs    headless benchmark and balance bots
```

**State layout.** Each entity kind (enemies, towers, projectiles, effects) is a struct of arrays: one typed array per field (`x`, `y`, `hp`, ...) plus a free list of slot indices and a generation counter per slot. Projectiles store `(slot, generation)` of their target, so a reused slot is never mistaken for the old enemy. All arrays are allocated once at startup with fixed capacity (12k enemies, 8k projectiles, 6k effects), so nothing grows during a run.

**One loop.** There is exactly one `requestAnimationFrame` callback. No entity owns a timer or an animation loop. Spawning, cooldowns and slows are counters stepped by the simulation.

**Fixed timestep.** The simulation always advances in 1/60 s ticks using an accumulator. A 144 Hz screen runs fewer ticks per frame, a 30 Hz screen runs two per frame, and the result is the same game. Rendering interpolates positions between the last two ticks, so movement stays smooth on high refresh displays. Catch-up is capped at `2 × speed + 2` ticks per frame so an overloaded frame cannot snowball. The perf panel has a frame cap (30 / 60 Hz) to show this live: the game moves at the same speed with either cap.

**Simulation order per tick.** spawn → move enemies → rebuild spatial grid → towers pick targets and fire → projectiles move and collide → effects → wave state.

**Separation.** `sim.js` never touches the DOM. It reports events (`kill`, `leak`, `wave`, `won`) through one listener. That is what makes the headless benchmark and the bot runs possible.

## Rendering approach

Three stacked canvases:

1. **Background (2D).** The map, path, trees, rocks and the keep are painted once into an offscreen canvas at 2x resolution. Each frame only blits that image, and only when the camera moved.
2. **Entities (WebGL2).** Every tower, enemy, health bar, projectile and effect is one instance in a single interleaved buffer (28 bytes: position, size, rotation, shape id, extra, packed RGBA). One `bufferSubData` and one `drawArraysInstanced` per frame. Shapes (circle, square, triangle, diamond, hexagon, ring, glow, bar) are drawn with signed distance functions in the fragment shader, with antialiasing from `fwidth`. No textures, no asset loading.
3. **Overlay (2D).** Build grid, ghost tower, range circles, floating gold numbers, damage vignette, pause screen. These are few and change every frame.

The DOM is only used for the HUD and panels.

## Major bottlenecks found

Measured with the stress scenario (5,000 enemies, 100 towers, 1,000+ projectiles):

1. **Projectile collision, O(projectiles × enemies).** Every bullet checked every enemy, every tick: about 5 million distance checks per tick. This was the biggest cost.
2. **Tower targeting, O(towers × enemies) with allocation.** Each tower built a new array of enemies in range and sorted it, every tick. This also created garbage, which shows up as GC pauses.
3. **Canvas2D draw calls.** One `beginPath/arc/fill/stroke` per enemy plus two `fillRect` for its health bar plus a new color string per entity. Thousands of state changes per frame. CPU bound in the browser's 2D backend.
4. **Drawing off-screen objects.** When zoomed in, the renderer still processed every entity.
5. **DOM writes.** Rewriting HUD `innerHTML` every frame forces style and layout work.

## Optimizations

| # | Optimization | What changed | Toggle in perf panel |
| --- | --- | --- | --- |
| 1 | Spatial hash grid | 32 px cells, rebuilt each tick with a counting sort into flat `Int32Array`s. Collision, splash and targeting only look at nearby cells | Spatial hash grid |
| 2 | Throttled retargeting | Towers keep a valid target and re-scan 10 times a second instead of 60. Best target is tracked in one pass, no array, no sort | Throttled retargeting |
| 3 | Instanced WebGL renderer | All entities in one draw call from one preallocated buffer | WebGL instanced renderer |
| 4 | Viewport culling | Entities outside the camera rect (plus margin) are skipped before they are written to the instance buffer | Viewport culling |
| 5 | HUD throttling | HUD updates at 10 Hz and only writes `textContent` when a value changed | Throttled HUD updates |

Always on (architecture, not toggled): struct of arrays storage, object pools with free lists, zero allocations in the hot loop, cached background, fixed timestep, catch-up cap.

"Initial version" in the perf panel switches all five toggles off. That recreates the hot paths of the first implementation inside the same build, so the before and after can be compared live on the same machine with the same scene.

## How performance was measured

**In the browser** (perf panel, `P`): a live frame time graph (green under 22 ms, yellow under 33 ms, red above), FPS, simulation ms, render ms, entity counts, drawn instances and JS heap (Chrome). "Record 10 s" skips 1 s of warm up, then records every frame delta from `requestAnimationFrame` into a fixed buffer and reports average FPS, the share of frames at 45+ FPS (frame time ≤ 22.2 ms), the share over 33 ms, p50 / p95 / p99, average sim and render time, and heap at start and end. It marks the run PASS when ≥ 95% of frames are at 45+ FPS and < 5% exceed 33 ms. "Copy table row" puts a markdown row on the clipboard for NUMBERS.md.

**Headless** (`npm run bench`): runs the same `sim.js` in node and times 300 ticks of the stress scenario for each optimization combo. It also plays all 50 waves with a bot and samples heap every 5 waves to confirm memory stays flat.

**Memory**: all entity storage is preallocated, so heap only moves with UI strings and GC sawtooth. Over a full 50 wave bot run, heap stayed between about 5 and 11 MB with no upward trend.

Results are in [NUMBERS.md](./NUMBERS.md).

## Things I would do next

Move the simulation to a Web Worker with a `SharedArrayBuffer` so heavy ticks never block input, sound effects, more maps, and a tower that chains between enemies.
