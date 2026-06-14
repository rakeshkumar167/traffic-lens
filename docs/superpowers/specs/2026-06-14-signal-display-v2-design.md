# Signal display v2 — one-per-direction, roadside, stop-line

Date: 2026-06-14
Status: approved, ready to build

## Goals
1. **One signal head per direction at a crossroad** (≈4), not one per incoming
   edge — divided-road intersections are split into several signal nodes in the
   data, so they must be clustered.
2. **Vertical signal head on the left of the road** (India LHT), beside the lane,
   not a wide box spanning across the road.
3. **Vehicles stop at the red mark** — halt at a stop line a few metres before
   the junction, where the head is drawn (today they stop at the node, past the
   mark).

## 1. Clustering + coherent phasing
- **Render:** cluster signalled junctions within **30 m**; gather their incoming
  approaches; group by bearing into directions (merge within ~45°); draw **one
  head per direction**, using a representative edge for position/heading/state.
- **Preprocessing (`junctions.ts`, + regen):** give each 30 m cluster a **shared
  phase axis** so member nodes are synchronised — all approaches on one axis go
  green together, the cross axis red. `groupApproachesByAxis` gains an optional
  `refAxis`; the cluster's axis = the bearing of its highest-class incoming edge.
  This keeps the sim and the display coherent (no conflicting greens).

## 2. Roadside vertical head
- Icon redrawn **portrait**: stacked straight ↑ / left / right arrows + red lamp,
  oriented so "up" = the approach's travel direction (so it stands along the road).
- Positioned at the stop line, **offset ~4 m to the left** of the approach lane
  (perpendicular-left of travel).

## 3. Stop line
- New shared constant `SIGNAL_STOP_LINE_M = 5`.
- Sim (`tick.ts`): for a red signalled approach, the virtual leader sits at
  `max(0, distToJunction − SIGNAL_STOP_LINE_M)` so vehicles stop at the line.
- Render: head drawn at the same `SIGNAL_STOP_LINE_M` back from the junction, so
  the stop line and the mark coincide. (Priority junctions unchanged.)

## Testing (TDD)
- `groupApproachesByAxis(refAxis)` honours the shared axis.
- clustering groups nearby signalled nodes; per-direction grouping yields ≤4 for a
  4-way; opposing directions land in the same phase.
- existing sim/preprocess suites stay green after regen (edge IDs unchanged).

## Data regeneration
Regenerate after the preprocessing change (existing bbox, edges unchanged):
```
pnpm -F @traffic-lens/osm-preprocess exec tsx src/cli.ts \
  --in ../../data/raw/koramangala.osm --out ../../data/koramangala.graph.json \
  --bbox 77.615,12.928,77.64,12.948
```

## Future requirement — more Bangalore regions
The app currently ships one preprocessed extract (Koramangala). Adding another
Bangalore area is a **data + preprocessing** task, not an app change, using the
existing `packages/osm-preprocess` CLI:
1. Drop an OSM extract for the area into `data/raw/<area>.osm` (e.g. via the
   Overpass API or a Geofabrik clip).
2. Run the CLI with that area's bbox → `data/<area>.graph.json`.
3. Make the app able to pick/load that graph (today `loadAssets` is hardcoded to
   `koramangala.graph.json`; a region picker / multi-graph loader would be the
   app-side follow-up).
Documented in `packages/osm-preprocess/README.md`. (No app changes in this spec.)
