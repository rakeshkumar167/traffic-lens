# Region selection & runtime demand — design

Date: 2026-06-13
Status: approved (brainstorming), ready to build

## Goal

On page load, let the user draw a rectangular region on the map, then run a
simulation populated only from that region. Every boundary-crossing edge of the
rectangle is both a spawn (entry) and a destination (exit); vehicles take random
entry→exit trips. Traffic volume is set by an intensity slider. No preprocessing
or network calls at runtime — we clip the already-loaded Koramangala graph.

## User flow / state machine

`App` has `mode: 'drawing' | 'running'`.

- **drawing** (initial): worker is NOT initialized. The full graph is loaded and
  shown. A setup panel shows an **intensity slider** and a **Start** button
  (disabled until a valid rectangle is drawn). The user click-drags on the map to
  draw an axis-aligned rectangle (lon/lat). Drawing again replaces it.
- **Start**: clip the graph to the rectangle, derive entry/exit edges, build a
  `Demand` from the intensity, initialize the worker with `{ clippedGraph, demand,
  sab }`, auto-play → `running`.
- **running**: vehicles animate (existing render path). A **Reset** control
  terminates the worker and returns to `drawing` (rectangle cleared).

## Drawing mechanism

Custom drag handler in `MapView` (no new deps). On mousedown→mousemove→mouseup over
the map container, capture two screen corners, `map.unproject()` each to lon/lat,
normalize into a `BoundingBox`. The in-progress and confirmed rectangle render via
the existing deck `PolygonLayer`. A drag smaller than a few pixels is ignored.

## Pure functions (in `packages/sim`, unit-tested)

### `clipGraph(fullGraph, bboxWorld) → { graph, entryEdgeIds, exitEdgeIds }`
`bboxWorld` is the selection rectangle in Web Mercator world coords (matches edge
geometry). A junction is "inside" if its position is within `bboxWorld`.

- **Kept edges**: any edge with at least one endpoint-junction inside. Kept
  junctions: those referenced by kept edges. `meta.bbox` is recomputed to the
  selection (lon/lat). `boundaryEdges` is recomputed (see below).
- **entryEdgeIds**: kept edges whose `fromJunction` is OUTSIDE and `toJunction` is
  INSIDE (they point inward — valid spawn edges; vehicle enters the region).
- **exitEdgeIds**: kept edges whose `fromJunction` is INSIDE and `toJunction` is
  OUTSIDE (they point outward — valid destinations; vehicle leaves the region).
- `boundaryEdges` = entryEdgeIds ∪ exitEdgeIds.

Edges fully inside are interior roads (routable, not entries/exits). Edges fully
outside are dropped.

### `buildDemand(entryEdgeIds, exitEdgeIds, intensityVph, seed) → Demand`
- One `source` per entry edge: `spawnEdgeId = entryId`, `vehiclesPerHour =
  intensityVph`, `destinations = exitEdgeIds.map(id => ({ exitEdgeId: id, weight: 1 }))`.
- `seed` fixed (default 42), `durationSec` nominal (e.g. 600; sim spawns
  continuously regardless).
- If there are zero entries or zero exits, return a demand with no sources (the UI
  guards against Start in that case and shows a hint).

Routing is unchanged: `SpawnController` calls `Router.findRoute` per spawn on the
clipped graph; pairs with no route are skipped (existing `if (!route) continue`).

## Projection helper (`packages/shared`)

Add `shared/src/projection.ts` exporting `lonLatToWebMercator` and
`webMercatorToLonLat` (EPSG:3857, R=6378137). `App` uses the forward transform to
convert the drawn lon/lat rectangle to `bboxWorld`; the renderer's inline inverse
in `vehicle-layer.ts` is refactored to use the shared one. (`osm-preprocess` keeps
its own canonical copy to avoid touching the offline build; minor, accepted
duplication.)

## Robustness fix (in scope)

`VehicleStore.spawn` currently throws when all 2000 slots are full, which the
intensity slider makes reachable. Change `SpawnController.step` to skip spawning
when `store.activeCount() >= MAX_VEHICLES` (graceful, no throw). Keep `spawn`'s
throw as a hard invariant guard.

## UI controls

A setup panel (new `SetupBar` or an extension of the existing controls), shown in
`drawing` mode: intensity slider (Low ≈150 / Medium ≈400 / High ≈800 veh/h per
entry, or a continuous range) + Start (disabled until a valid rect with ≥1 entry
and ≥1 exit). In `running` mode, the existing `PlaybackBar` plus a Reset button.

## Rendering changes

- `MapView` gains `mode`, `selectionRect` (lon/lat bbox), `onSelectionChange`.
- The selection rectangle replaces the old full-extent boundary overlay and is
  drawn with a **thicker border** (`lineWidthMinPixels` 2 → 4).
- Vehicles render only in `running` mode.

## Testing

- `clipGraph`: interior vs boundary classification; inward (entry) vs outward
  (exit) orientation; junction-inside test; recomputed bbox/boundaryEdges; empty
  selection yields no entries/exits.
- `buildDemand`: one source per entry, all exits as weighted destinations, empty
  inputs → no sources.
- Sim integration: a clipped sub-region spawns and despawns over 60 sim-seconds
  with no NaN/crash, and respects the 2000-vehicle cap (no throw at high intensity).

## Out of scope (YAGNI)

Per-edge or per-side entry/exit picking; arbitrary geography / Overpass fetch;
runtime OSM preprocessing; saving/sharing selected regions; non-rectangular
selections.
