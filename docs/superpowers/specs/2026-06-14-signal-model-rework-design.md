# Signal-model rework — design

Date: 2026-06-14
Status: approved, ready to build

## Problem

OSM tags `highway=traffic_signals` on stop-line nodes along each approach, not on
the intersection. So today a real 4-way signal becomes ~4 single-approach
signalled nodes, each permanently green (32 of 44 signals have one approach).
Crossroads never alternate, and timing is a fixed 30s/60s regardless of size.

## Approach (decided)

Place signals **structurally** at real crossroads instead of trusting OSM tags;
build **opposing-pair phasing**; scale **green by road class**. Changes are
confined to `packages/osm-preprocess/src/junctions.ts` plus a graph regen.

### 1. Signal placement
A node is **signalled** iff it has **≥4 distinct neighbor legs** AND its biggest
approach road-class rank ≥ **tertiary**; otherwise **priority** (give-way). This
ignores OSM's stop-line `traffic_signals` tags (the source of the always-green
artifacts). "Legs" = distinct neighbor junctions over incoming ∪ outgoing edges.
Thresholds (`MIN_SIGNAL_LEGS = 4`, `MIN_SIGNAL_RANK = tertiary`) are constants.

### 2. Phasing — `groupApproachesByAxis(incomingEdges, edgeById)`
Pure helper. Compute each incoming edge's **approach bearing** (direction of its
last segment, into the junction); reduce to an axis (`bearing mod 180`). Pick the
first approach's axis as reference; **phase A** = approaches within 45° of the
reference axis, **phase B** = the rest. Opposing approaches (≈180° apart, same
axis) land together → "NS-green then EW-green". Returns two `EdgeId[]` groups
(B may be empty for degenerate inputs → single always-green phase, which only
happens off the ≥4-leg path).

### 3. Timing — green per phase by road class
From the junction's max approach road class:
`residential/unclassified/service → 20s`, `tertiary(_link) → 25s`,
`secondary(_link) → 35s`, `primary(_link) → 45s`. Both phases use that green;
`cycleSec = 2 × green`. (Per-phase-by-its-own-road-class is a possible later
refinement.)

`defaultSignalPlanFor` is rewritten to use #2 and #3; its previously-unused
`edgeById` param is now used.

### 4. Data regeneration
Re-run the preprocessor with the **existing bbox** so only junction
classification + plans change and **edge IDs stay stable** (keeps `demand.json`
and sim tests valid):

```
tsx packages/osm-preprocess/src/cli.ts \
  --in data/raw/koramangala.osm \
  --out data/koramangala.graph.json \
  --bbox 77.615,12.928,77.64,12.948
```

Commit the regenerated graph; Vercel redeploys (the build copies it to dist).

## No changes elsewhere
The sim (`isEdgeGreen`/`advanceSignalState`/`virtualLeaderFor`) and the signal
overlay (`greenIncomingEdgesAt`) already consume arbitrary plans. Crossroads will
simply start alternating and vehicles will queue per side.

## Testing
- `groupApproachesByAxis`: a synthetic 4-way (N/E/S/W) groups N+S vs E+W;
  perpendicular approaches never share a phase; a 3-way degrades sensibly.
- timing: road-class → green mapping (boundaries per class).
- signalled predicate: ≥4 legs + tertiary → signalled; 3-leg or residential → not.
- post-regen smoke: signalled count is in a sane range; a known 4-way has two
  phases with opposing-axis groups; edge count unchanged from the current graph.

## Out of scope
Per-phase asymmetric green, amber/all-red clearance, turn phases, actuated/
adaptive timing, pedestrian phases.
