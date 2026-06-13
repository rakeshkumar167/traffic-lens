import type {
  BoundingBox, Demand, DemandSource, EdgeId, JunctionId, RoadGraph,
} from '@traffic-lens/shared';

export interface ClipResult {
  readonly graph: RoadGraph;
  readonly entryEdgeIds: EdgeId[];
  readonly exitEdgeIds: EdgeId[];
}

/**
 * Clip a road graph to a lon/lat rectangle. Junctions carry lon/lat, so the
 * test is purely geographic. An edge is kept if either endpoint is inside the
 * box. Edges crossing the border are entries (point inward) or exits (point
 * outward); fully-interior edges are kept but are neither.
 */
export function clipGraph(fullGraph: RoadGraph, bbox: BoundingBox): ClipResult {
  const junctionById = new Map<JunctionId, RoadGraph['junctions'][number]>(
    fullGraph.junctions.map((j) => [j.id, j]),
  );
  const inside = (id: JunctionId): boolean => {
    const j = junctionById.get(id);
    if (!j) return false;
    return j.lon >= bbox.minLon && j.lon <= bbox.maxLon
      && j.lat >= bbox.minLat && j.lat <= bbox.maxLat;
  };

  const keptEdges: RoadGraph['edges'][number][] = [];
  const entryEdgeIds: EdgeId[] = [];
  const exitEdgeIds: EdgeId[] = [];
  const keptJunctionIds = new Set<JunctionId>();

  for (const e of fullGraph.edges) {
    const fromIn = inside(e.fromJunction);
    const toIn = inside(e.toJunction);
    if (!fromIn && !toIn) continue;
    keptEdges.push(e);
    keptJunctionIds.add(e.fromJunction);
    keptJunctionIds.add(e.toJunction);
    if (!fromIn && toIn) entryEdgeIds.push(e.id);
    else if (fromIn && !toIn) exitEdgeIds.push(e.id);
  }

  const boundaryEdges = [...entryEdgeIds, ...exitEdgeIds];
  const graph: RoadGraph = {
    meta: { ...fullGraph.meta, bbox },
    edges: keptEdges,
    junctions: fullGraph.junctions.filter((j) => keptJunctionIds.has(j.id)),
    boundaryEdges,
  };
  return { graph, entryEdgeIds, exitEdgeIds };
}

/**
 * Build a Demand where every entry edge spawns vehicles routed to a uniformly
 * random exit edge. Returns no sources if either set is empty.
 */
export function buildDemand(
  entryEdgeIds: readonly EdgeId[],
  exitEdgeIds: readonly EdgeId[],
  intensityVph: number,
  seed: number,
  durationSec = 600,
): Demand {
  if (entryEdgeIds.length === 0 || exitEdgeIds.length === 0) {
    return { seed, durationSec, sources: [] };
  }
  const destinations = exitEdgeIds.map((exitEdgeId) => ({ exitEdgeId, weight: 1 }));
  const sources: DemandSource[] = entryEdgeIds.map((spawnEdgeId, i) => ({
    id: `entry_${spawnEdgeId}_${i}`,
    spawnEdgeId,
    vehiclesPerHour: intensityVph,
    destinations,
  }));
  return { seed, durationSec, sources };
}
