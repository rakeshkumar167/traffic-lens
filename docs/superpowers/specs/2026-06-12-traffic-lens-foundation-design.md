# Traffic-Lens — Foundation Slice Design

**Date:** 2026-06-12
**Status:** Draft — pending user review
**Scope:** First sub-project of the broader Bengaluru Traffic Simulator (see `requirements.md`)

## Why this slice exists

The `requirements.md` describes a multi-subsystem product (map foundation, microscopic sim, GPU rendering, editing UI, analytics, viewport-aware LOD, scenario persistence, future extensions). Trying to design all of it in one spec produces something too vague to implement. The **foundation slice** is the smallest end-to-end vertical that proves the architectural spine before any of the more visible features are added on top.

This spec covers only the foundation slice. Every later subsystem gets its own design and plan.

## Success criteria

> Open the app in a desktop browser. After a brief loading state, the Koramangala 5th/6th Block area renders on a MapLibre base map. Roughly 300–500 cars are visibly entering the area at the boundary edges, routing through the neighborhood toward their destinations, slowing and queueing at the signal junctions, yielding to cross-traffic at the priority junctions, and exiting at the far boundary edges. No vehicles overlap. No vehicles get stuck indefinitely. The sim runs at 30 Hz and the renderer at a steady 60 FPS on a mid-range laptop. Hitting Pause freezes everything; Step advances one tick; reseeding produces a different but equally-correct run; replaying with the same seed produces a bit-identical run.

If we ship that demo, every subsequent milestone (editing, analytics, scenarios, LOD, two-wheelers, signal-timing) can plug in around this core without needing to rewrite it.

## Architectural decisions (confirmed during brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Slice scope | Small neighborhood (~1–2 km², 5–15 intersections) |
| 2 | Sim execution model | Web Worker in TypeScript |
| 3 | OSM data flow | Preprocess offline, ship static asset |
| 4 | Build/framework | Vite + React SPA |
| 5 | Sim↔render state sync | `SharedArrayBuffer` + struct-of-arrays, fixed 30 Hz sim, interpolated 60 FPS render |
| 6 | Vehicle entry/exit model | Edge-entry / edge-exit with hardcoded OD demand JSON; A* routing at spawn |
| 7 | Vehicle mix & driver behavior | Cars only, single "average" driver profile |
| 8 | Intersection control | Signals from OSM tags + default cycle; uncontrolled junctions use priority-yield + gap-acceptance |
| 9 | Neighborhood | Koramangala 5th/6th Block area |

WASM, dynamic re-routing, two-wheeler lane-filtering, editing UI, heatmaps, scenario persistence, and viewport LOD are all explicitly **out of scope** for this slice. See the YAGNI section.

## System architecture

The foundation slice is a **three-layer system** with one well-defined boundary between each layer.

### Layer 1 — Offline preprocessing
A Node.js CLI (`packages/osm-preprocess/`). Runs on the dev machine, not in the browser. Owns:
- Downloading or loading a `.osm.pbf` extract for the Koramangala bounding box
- Parsing roads/lanes/intersections/signal tags
- Normalizing into a directed lane-level graph
- Emitting a single static asset (`koramangala.graph.json`)

The output graph is the contract; this layer can be rewritten or moved to a backend later without touching the sim.

### Layer 2 — Simulation core
TypeScript module (`packages/sim/`) compiled into a Web Worker bundle. No DOM, no rendering, no React. Owns:
- Holding the road graph
- A* routing on it
- Owning the `SharedArrayBuffer` that holds vehicle state as struct-of-arrays
- Advancing IDM/MOBIL physics at a fixed 30 Hz tick
- Managing signal phase and priority-yield logic
- Spawning/despawning vehicles per the OD demand

Talks to the renderer only by writing to the SAB and posting occasional control-acknowledgement messages. Pure, deterministic, headless — testable without a browser, profilable in isolation, swappable for WASM later behind the same SAB interface.

### Layer 3 — Application shell
Vite + React app at the repo root. Main thread only. Owns:
- MapLibre base map
- deck.gl instanced-vehicle layer (reads the SAB directly each frame, interpolates between sim ticks)
- React UI shell (minimal: neighborhood info, FPS/tick counter, basic playback controls)
- Worker lifecycle
- Loading the static graph asset on startup

### Boundaries
The three boundaries between layers are:
- **The graph file** (Layer 1 → 2)
- **The SAB layout** (Layer 2 → 3)
- **The worker message protocol** (Layer 3 → 2, for play/pause/step/setSpeed control)

### Repo layout

```
traffic-lens/
  packages/
    osm-preprocess/       # Layer 1, Node CLI
    sim/                  # Layer 2, runs in worker
    shared/               # SAB schema, message types, road-graph types
  src/                    # Layer 3, Vite + React app
  data/
    raw/                  # .osm.pbf extract(s), gitignored or LFS as appropriate
    koramangala.graph.json    # output of Layer 1, input to Layer 3
    koramangala.demand.json   # hand-authored OD demand
  index.html
  vite.config.ts
  vercel.ts
  package.json            # workspace root
```

## Shared state schema

One `SharedArrayBuffer` is allocated at startup, sized for `MAX_VEHICLES = 2000` (comfortable headroom above the foundation slice's "few hundred" target). Each per-vehicle field is its own typed-array view over a fixed slice of the SAB:

| Field | Type | Notes |
|---|---|---|
| `posX[i]` | `Float32` | World x in MapLibre projected coords |
| `posY[i]` | `Float32` | World y |
| `heading[i]` | `Float32` | Radians |
| `speed[i]` | `Float32` | m/s |
| `accel[i]` | `Float32` | m/s² (last tick's IDM output) |
| `edgeId[i]` | `Uint32` | Current lane-graph edge |
| `edgeProgress[i]` | `Float32` | 0..1 along the edge |
| `lane[i]` | `Uint8` | 0..numLanes-1 on the edge. **Convention:** `lane = 0` is the leftmost lane in the direction of travel (closest to the kerb in India / left-hand traffic). `lane = numLanes-1` is the rightmost (overtaking) lane. |
| `state[i]` | `Uint8` | 0=free, 1=active, 2=despawning |
| `vehicleType[i]` | `Uint16` | Always `CAR` in the slice; reserved for future |
| `routeIdx[i]` | `Uint16` | Index into vehicle's route edge list |

A small control region at the top of the SAB holds:
- Current tick number (`Uint32`)
- Sim wall-clock seconds (`Float64`)
- A render-snapshot pointer pair, double-buffered so the renderer always reads a consistent pair of ticks for interpolation

**Routes are not in the SAB.** Each vehicle's route (sequence of edge IDs) lives in a regular `Map<vehicleId, Uint32Array>` in the worker, because routes are variable-length and only the worker reads them. The SAB carries only the per-tick numeric state the renderer needs.

**Free-slot management:** a simple free-list — when a vehicle despawns, its slot is returned; when one spawns, an empty slot is allocated. No GC, no compaction.

## Sim tick loop

The worker runs a fixed 30 Hz loop. Each tick (`dt = 1/30 s`):

1. **Signal phase update** — advance signal timers; flip phases as needed.
2. **Spawn pass** — for each demand source, sample whether to spawn (Poisson with `rate = vehiclesPerHour / 3600`). On spawn: pick destination by weighted distribution, A* the route, allocate a free slot, initialize at edge start; if the spawn lane is blocked within 10 m, hold for the next tick.
3. **Perception pass** — for each active vehicle, find the leader on its lane within a lookahead distance (spatial index per edge).
4. **Decision pass (IDM)** — compute acceleration from leader gap + speed.
5. **Decision pass (MOBIL)** — evaluate adjacent-lane changes for safety + incentive; commit if accepted.
6. **Intersection pass** — vehicles approaching a junction:
   - **Signalled** → obey light (red = virtual leader at the stop line, speed 0).
   - **Uncontrolled priority** → yield to major; gap-acceptance on minor; virtual leader at the junction entrance if no gap.
7. **Integrate** — `speed += accel·dt`; `edgeProgress += speed·dt / edgeLen`; if progress ≥ 1, advance to next route edge, or despawn if route is complete.
8. **Write to inactive buffer** — flush updated `posX/posY/heading/speed` to SAB.
9. **Flip render snapshot** — atomic store of new tick number.

Steps 3–7 are all `for (i = 0..MAX_VEHICLES)` loops over the SoA fields. No allocations in the hot path after warmup.

**Determinism.** The sim is fully deterministic given (graph, demand, seed, tick count). We use a small seeded PRNG (mulberry32 or PCG) for all randomness — spawn timing, route weights, driver micro-variation. Replays with the same seed are bit-identical.

**Why 30 Hz, not 60.** IDM is stable at 30 Hz for car-following timescales, and 30 Hz halves per-vehicle work. The renderer still produces 60 FPS by interpolating between the two latest sim ticks.

## OSM preprocessing pipeline

A one-shot Node CLI. Run once, commit the output, ship it as a static asset. Rerun to change the neighborhood.

### Input

A `.osm.pbf` extract clipped to the Koramangala bounding box. We will use `osmium extract` against a regional OSM extract (Geofabrik or BBBike). The script will support either a local `.osm.pbf` path or a documented download URL; the raw extract is gitignored.

### Stages

1. **Parse.** Keep only ways tagged `highway=*` in the drivable set: `primary`, `secondary`, `tertiary`, `residential`, `unclassified`, `service`, plus the `_link` variants. Keep nodes tagged `highway=traffic_signals`, `highway=stop`, `highway=give_way`. Discard everything else.

2. **Build the lane-level directed graph.**
   - Each OSM way becomes 1 or 2 directed edges (one per direction unless `oneway=yes`).
   - Lane count from `lanes=` tag if present; otherwise road-class defaults: `primary`→3, `secondary`→2, `tertiary`→2, `residential`→1, `service`→1.
   - Edge geometry: list of `(lon, lat)` points along the way, plus precomputed length in metres (Haversine).
   - Project all geometry to MapLibre Web Mercator world coordinates once, here, so sim and renderer never reproject.

3. **Resolve intersections.** Any node shared by ≥2 kept ways becomes a junction. For each junction:
   - Classify: `signalled` if any incident node has the signal tag, else `priority` (rank approaches by road class).
   - Build a connection table: which incoming-edge-lane connects to which outgoing-edge-lane. The slice uses a default policy keyed to India's left-hand traffic: the leftmost lane (`lane = 0`, kerb side) feeds left turns and straight; the rightmost lane (`lane = numLanes-1`) feeds right turns and straight; middle lanes feed straight only. We do not parse `turn:lanes` in this slice.

4. **Identify entry/exit edges.** Edges whose "outer" end falls outside the bbox or terminates at a kept-but-now-dangling node become boundary edges, referenced by the demand JSON for spawning/despawning.

5. **Sanity-check.** Reject the build if any edge has zero length, the graph isn't weakly connected, a signal junction has zero incoming edges, etc. Print a report and exit non-zero.

6. **Emit `koramangala.graph.json`.** Structure:

```jsonc
{
  "meta": { "bbox": [...], "projection": "webMercator",
            "generatedAt": "...", "sourceHash": "...", "scriptVersion": "..." },
  "edges": [
    { "id": 1042, "fromNode": 17, "toNode": 18,
      "geometry": [[lon, lat], ...], "lengthM": 142.3,
      "lanes": 2, "roadClass": "secondary", "oneway": false }
  ],
  "junctions": [
    { "id": 17, "lon": 77.62, "lat": 12.93,
      "kind": "signalled",
      "incomingEdges": [...], "outgoingEdges": [...],
      "connections": [{ "fromEdge": 1042, "fromLane": 0, "toEdge": 2310, "toLane": 0 }, ...],
      "defaultSignalPlan": { "cycleSec": 60, "phases": [...] } }
  ],
  "boundaryEdges": [1042, 2310, ...]
}
```

### Determinism

Same `.osm.pbf` + same script version → bit-identical graph file. `scriptVersion` is stamped into `meta`; the sim refuses to load a graph version it doesn't recognize.

### Explicit non-goals for slice-era extraction
- No `turn:lanes` parsing (default connection policy instead)
- No `maxspeed` parsing yet (road-class defaults)
- No roundabout-specific handling (treat as priority junction)
- No barrier/access tag interpretation
- No live OSM fetching at runtime

## Demand, routing, and intersection control

### Demand JSON

Hand-authored for the slice. The schema is exactly what the editing UI will later edit graphically.

```json
{
  "seed": 42,
  "durationSec": 3600,
  "sources": [
    {
      "id": "north_in",
      "spawnEdgeId": 1042,
      "vehiclesPerHour": 1200,
      "destinations": [
        { "exitEdgeId": 2310, "weight": 0.6 },
        { "exitEdgeId": 2188, "weight": 0.4 }
      ]
    }
  ]
}
```

The slice ships with 4–6 sources (one per major boundary entry into Koramangala) and 2–3 destination weights each.

### Spawning

Per-source Poisson process at rate `vehiclesPerHour / 3600` per sim second. Each tick, for each source, draw whether to spawn. On spawn:
- Pick destination by source's weighted distribution.
- Run A* on the road graph (cost = `edgeLength / roadClassSpeedEstimate`). Cache results per OD pair; there are only a small number of OD pairs.
- Allocate a free slot; initialize `posX/posY` at spawn-edge start, `lane = 0` (leftmost, kerb side — the natural slow/entry lane in left-hand traffic), `speed = roadClassSpeedEstimate`, `routeIdx = 0`.
- If the spawn lane is blocked within 10 m, hold the spawn for the next tick.

### Routing

Vehicles route at spawn only — no dynamic re-routing in the slice. Routes are static `Uint32Array` lists of edge IDs.

When a vehicle reaches the end of its current edge:
- The next edge comes from its route.
- The junction's connection table determines which lane on the next edge to enter.
- If a lane change is needed before the junction (e.g., next edge requires the middle lane), MOBIL gets a strong incentive to make that change in the lead-up.

### Intersection control

**Signalled junctions.** Each signal junction owns a phase state machine. Default plan: two phases (NS green / EW green), 30 s green per phase, no amber in the slice. For more than two approaches, the slice round-robins approach pairs in a deterministic order. Phase advance happens in step 1 of the tick loop.

A vehicle on an approach lane within braking distance of a red light treats the stop-line as a virtual IDM leader at speed 0. When the light turns green, the virtual leader vanishes and IDM lets the vehicle accelerate normally. Queue formation falls out of this automatically.

**Priority junctions.** Each (incoming-edge, outgoing-edge) connection is marked `priority` or `yield`. A vehicle on a yield edge approaching the junction does a gap-acceptance check: project all priority-edge vehicles within ~50 m onto a time-to-junction axis; accept if `t(self) + safetyMargin < min(t(others))`. If rejected, treat the junction entrance as a virtual leader at 0 m/s until a gap appears.

**Boundary exit.** When a vehicle's `routeIdx` advances past the last edge in its route, it is despawned the next tick: `state[i] = FREE`, slot returned to the free list.

### Slice-era deferrals
- Amber phase / dilemma-zone modeling
- Indian-style right-turn-on-red flexibility
- Lane-occupancy awareness during the spawn check (simple distance only for now)
- "Stuck vehicle" detection and recovery

## Rendering and UI shell

### Main-thread loop (60 FPS via `requestAnimationFrame`)

Each frame:
1. Read the SAB's current and previous render-snapshot tick pointers. Compute `alpha = (nowSec − tickStartSec) / tickDurationSec`, clamped to `[0, 1]`.
2. Hand both typed-array views and `alpha` to the deck.gl vehicle layer.
3. deck.gl renders.

### deck.gl vehicle layer

A custom `Layer` (initial v0: thin wrapper around `ScatterplotLayer` or a textured `IconLayer`; v0.5: a proper instanced model layer). Critically: we do **not** copy SAB data into deck.gl attribute buffers. The SAB-backed `Float32Array` is registered directly as the layer's `getPosition` accessor source, so deck.gl uploads the bytes the sim wrote, unchanged. Interpolation happens in the GPU vertex shader by passing both tick snapshots and `alpha` as attributes. This is the architectural payoff of the Section "Shared state" design.

For the slice, vehicles render as small oriented rectangles (2 m × 4 m world coords) coloured by speed.

### MapLibre base map

Vector tiles from a free style provider (MapTiler free tier or OSM Bright). The tile-provider choice is pinned in `vite.config.ts` and documented in `README.md`. The deck.gl `MapboxOverlay` plugs the vehicle layer directly into MapLibre's renderer so both share one WebGL context and one camera.

### Camera defaults

Initial view: Koramangala 5th Block centroid, zoom ~16. Pan/zoom: MapLibre default.

### React UI shell — minimal for the slice

Bottom bar:
- Play / Pause / Step
- Sim-speed selector (0.5×, 1×, 2×, 4×) — sent to the worker as a control message
- "Tick: N · Vehicles: M · Sim FPS: X · Render FPS: Y" counter
- Debug toggle: overlays edge IDs on hover, junction IDs, signal-phase indicators, hovered vehicle's route polyline

No road-selection UI, no density editor, no scenarios panel, no heatmaps.

### Worker lifecycle

- On app load: fetch graph JSON, fetch demand JSON, allocate SAB, post `{ type: 'init', graph, demand, sab }` to worker.
- Worker replies `{ type: 'ready' }` once warmed up. UI enables Play.
- Control messages: `play`, `pause`, `step`, `setSpeed`, `reseed`.
- One worker. If it dies, surface the error in a toast with a reload button. No auto-restart.

### Asset loading

Graph JSON fetched once at startup with a loading splash. ~1–2 MB gzipped — no streaming or chunking.

### Browser support

Latest Chrome and Firefox. SAB requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` — set by Vite dev server config and `vercel.ts` headers config for production. Safari 15+ best-effort with a manual smoke test.

## Testing strategy

Heavy on isolated unit tests for the pure layers; light on browser/E2E tests for the rest. The architecture is chosen partly to make this clean.

### Layer 1 — preprocessing
A tiny committed fixture: a hand-crafted `.osm.pbf` (≤20 nodes, ≤10 ways) covering one signal junction, one priority junction, a one-way, a divided road, and a `service` road. Snapshot test on the emitted graph JSON.

### Layer 2 — sim
Most testing energy goes here. The sim is a pure function of (graph, demand, seed, tickCount) → SAB state.

- **IDM unit tests** — known scenarios (free road, single leader at fixed distance, leader braking) compared against published reference values from the Treiber paper. Fail if acceleration disagrees beyond a small epsilon.
- **MOBIL unit tests** — synthetic two-lane setup; verify lane changes happen iff incentive + safety criteria are met.
- **Priority-yield unit tests** — synthetic 4-way intersection; vary cross-traffic timing; check the yielding vehicle's go/no-go decision.
- **Signal phase unit tests** — assert phases advance at the right tick; lights correct at boundaries.
- **Determinism test** — run for 10,000 ticks from seed 42 twice; byte-compare the SAB.
- **Smoke test** — run for 60 sim-seconds; assert: no vehicle's distance to its leader ever goes negative (no overlaps), no `NaN`, no vehicle stuck with `speed = 0` for >30 s on a green-light approach.

All run headless under Vitest in Node. The sim module has no DOM dependency by design.

### Layer 3 — rendering/UI
- Worker-boot smoke test (SAB non-zero within 2 s).
- Playwright "load + play + 5 s + screenshot" — pure "did anything render" check.

Visual debugging is the real safety net here: the debug overlay (edge IDs, routes, signal phases) is the tool we use to find bugs the unit tests miss.

### Not tested automatically
deck.gl rendering correctness, MapLibre integration, animation smoothness — verified by running the app and looking at it. Type-checking + visual review is the contract.

## Error handling

Different philosophy per layer.

### Layer 1 (preprocessing)
Fail loudly. Any malformed input or sanity-check violation aborts the build with a clear error message and non-zero exit code. We'd rather have no graph file than a silently-broken one.

### Layer 2 (sim)
Validate on `init` (graph shape, demand shape, seed present); throw on bad input → worker posts an error message → UI surfaces it. After init, the sim hot path assumes valid state — no per-tick defensive checks, no try/catch in inner loops. If the sim crashes mid-run (assertion failure, unexpected `NaN`), the worker catches at the tick boundary, posts an error message with the tick number, and stops.

### Layer 3 (app)
One global React error boundary. Worker errors render a toast + reload button. Asset-load failures render a "couldn't load map data" state with retry. Anything else surfaces to the console.

### Deliberately not added
- No error recovery in the sim — a crash means stop, not best-effort. Determinism is more valuable than uptime here.
- No automatic worker restart — if it's a deterministic bug, retry would loop.
- No telemetry/Sentry — added later when there are real users.

## YAGNI / explicit non-goals for this slice

Each item is in `requirements.md` and is deliberately not in this slice. Each has a designated future milestone where it gets its own design and plan.

| Out of scope | Future milestone |
|---|---|
| Editing UI (road click, density editor, vehicle-mix sliders, signal-timing editor) | Editing UI |
| Heatmaps and analytics overlays (congestion, speed, queue, travel time) | Analytics |
| Two-wheelers, buses, trucks | Vehicle mix |
| Driver profiles (conservative / aggressive / two-wheeler filtering) | Bengaluru-specific behavior |
| Viewport-based LOD (street / area / city view aggregation) | Scalability |
| Scenario save/load (JSON export, named presets) | Scenario management |
| Dynamic re-routing | Routing v2 |
| Bengaluru-wide coverage | Multi-neighborhood / city-scale |
| Live OSM fetching at runtime | Backend / multi-neighborhood |
| Backend of any kind | Emerges with scenario sharing or live OSM |
| Amber phase, right-turn-on-red, `turn:lanes` parsing | Intersection v2 |
| WASM/Rust sim | Performance (once profiling shows need) |
| Mobile / touch | Probably never |

## Open questions to resolve during implementation planning

- Exact `.osm.pbf` source (BBBike on-demand extract vs Geofabrik regional) and the documented `osmium extract` bbox.
- MapTiler vs alternative tile provider; rate limits in dev vs prod.
- Per-edge spatial index data structure for the perception pass (sorted-by-progress array vs uniform bins) — pick during sim implementation based on profiling.
- Exact IDM and MOBIL parameter values for the "average" profile. The Treiber defaults are a fine starting point; tune visually.

## What we will know is "done"

The success-criteria paragraph at the top of this document is the acceptance test. If we can demo that, the foundation is sound, and every future milestone in `requirements.md` plugs in around it without rewrite.
