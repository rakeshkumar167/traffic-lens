# Live traffic-signal overlay — design

Date: 2026-06-14
Status: approved (option 2), ready to build

## Goal

Show traffic signals on the map with live per-approach state: at each signalled
junction, a small dot on each incoming approach, coloured green when that
approach has right-of-way and red when it doesn't, updating in real time as the
sim runs.

## Why it's render-only (no sim/worker/SAB changes)

A signal's phase is a deterministic function of elapsed sim time. The plan
(`defaultSignalPlan`) is in the graph (already on the main thread), and elapsed
time (`control.simWallClockSec`) is already in the SharedArrayBuffer the renderer
reads each frame. So the renderer computes green/red locally. Nothing in the
worker, SAB layout, or sim loop changes.

## Pieces

### Pure helper (in `packages/sim`, unit-tested)
`greenIncomingEdgesAt(plan: SignalPlan, simSec: number): readonly EdgeId[]`
— mirrors `advanceSignalState`'s phase derivation (`simSec mod cycleSec` → phase
index → that phase's `greenIncomingEdges`). Empty plan → `[]`. Exported from the
sim index. A test asserts it agrees with `advanceSignalState` + `isEdgeGreen`.

### Render module (`src/render/signal-layer.ts`)
- `buildSignalMarkers(graph)`: for each `signalled` junction and each of its
  incoming edges **that exists in the (clipped) graph**, compute a stop-line
  point ~8 m back from the junction along that edge (in Web Mercator), convert to
  lon/lat. Returns `{ junctionId, edgeId, position: [lon,lat] }[]` plus a
  `Map<JunctionId, SignalPlan>`. Pure; computed once per run.
- `buildSignalLayer(markers, plansByJunction, simSec)`: a `ScatterplotLayer`;
  per junction compute the green edge set once via `greenIncomingEdgesAt`, then
  colour each marker green (`#1FBF5A`-ish) if its edge is green, else red.
  Small fixed pixel radius, thin dark outline.

### Wiring
- `App`: `useMemo` `buildSignalMarkers(simConfig.graph)` when a run starts; pass
  `signalMarkers` + `signalPlans` to `MapView`.
- `MapView`: in the running-mode frame loop, append `buildSignalLayer(...,
  simSec)` (read `views.control.simWallClockSec[0]`) above the vehicle layer.
- Shared inverse projection: extract `webMercatorToLonLat` into
  `src/render/projection.ts` and reuse it in both `vehicle-layer.ts` and
  `signal-layer.ts` (removes the duplicated inline formula).

## Notes / out of scope
- Clipped junctions may list incoming edges that were dropped — skip those.
- No amber/clearance phase (not modelled). No turn arrows. Pairs naturally with
  the future size-based signal-timing change but is independent of it.
- Markers are static geometry; only their colour changes per frame.
