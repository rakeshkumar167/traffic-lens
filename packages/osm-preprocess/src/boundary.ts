import type { Edge, EdgeId, Junction } from '@traffic-lens/shared';

// A boundary edge is one whose start or end junction has degree 1 — i.e., a
// dangling stub where vehicles spawn or despawn. The demand JSON references
// these by edge id.
export function findBoundaryEdges(
  edges: readonly Edge[],
  junctions: readonly Junction[],
): readonly EdgeId[] {
  const degreeByJunction = new Map<number, number>();
  for (const j of junctions) {
    degreeByJunction.set(j.id, j.incomingEdges.length + j.outgoingEdges.length);
  }
  const result: EdgeId[] = [];
  for (const e of edges) {
    const fromDeg = degreeByJunction.get(e.fromJunction) ?? 0;
    const toDeg = degreeByJunction.get(e.toJunction) ?? 0;
    if (fromDeg <= 1 || toDeg <= 1) result.push(e.id);
  }
  return result;
}
