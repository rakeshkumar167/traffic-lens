# Spawn-point selection — design

Date: 2026-06-14
Status: approved, ready to build

## Goal

Instead of spawning vehicles from every boundary entry edge (which overloads the
region's edges), let the user pick *which* entry points spawn vehicles. After the
rectangle is drawn, highlight the candidate spawn points on the map; the user
multi-selects by clicking; only selected points spawn. Destinations stay
automatic (any exit edge, random).

## Interaction (two sub-steps in setup/`drawing` mode)

- **No box yet** → drag to draw the rectangle (unchanged).
- **Box drawn** → candidate entry markers appear at each spawn location; clicking
  a marker toggles it. Drag-to-draw is disabled here so clicks only pick.
- **Redraw region** (SetupBar button) clears the box + selection → back to draw.
- Default: nothing selected; **Start** disabled until ≥1 point is selected.

## Components

### `src/render/entry-points.ts` (new)
- `buildEntryMarkers(graph, entryEdgeIds) → { edgeId, position:[lon,lat] }[]`:
  marker at each entry edge's spawn point (`geometry[0]`, the outside end),
  projected via `webMercatorToLonLat`.
- `buildEntryLayer(markers, selectedIds) → ScatterplotLayer` (pickable, fixed
  pixel radius): unselected = amber hollow ring, selected = filled green/larger.

### `App`
- New state `selectedEntryIds: number[]`.
- `entryMarkers = useMemo(buildEntryMarkers(clip.graph, clip.entryEdgeIds))`.
- `onSelectionChange` (new box) and `handleReset`/`handleRedraw` clear the selection.
- `onToggleEntry(edgeId)` adds/removes from `selectedEntryIds`.
- **Start** → `buildDemand(selectedEntryIds, clip.exitEdgeIds, intensity, 42)`
  (only the selected subset spawns; `clipGraph`/`buildDemand` unchanged).

### `MapView`
- New props: `entryMarkers`, `selectedEntryIds`, `onToggleEntry`.
- Setup-mode effect branches on whether a box exists:
  - **no box**: attach drag-draw handlers, render guide only.
  - **box**: render guide + selection + entry-points layer; set the overlay
    `onClick` to toggle the picked marker's `edgeId`; no drag handlers.
- Running-mode frame loop unchanged (entry markers/onClick irrelevant there;
  vehicle/signal layers are non-pickable).

### `SetupBar`
- Show **"Spawn points: N selected / M available"** + hint ("Click the
  highlighted points to choose where vehicles enter").
- **Start** gated on `N ≥ 1`; add a **Redraw region** button.

## Out of scope
Exit/destination selection (automatic), per-point spawn rates (global intensity).

## Testing
Logic is thin: `buildEntryMarkers` (geometry→lon/lat) and passing a subset to the
already-tested `buildDemand`. Light tests; rely on visual check for the picking UX.
