import type { Edge, EdgeId, Junction } from '@traffic-lens/shared';

// A boundary junction has at most one unique neighbor junction in the graph
// — i.e., only one other road connects to it, so it's a dangling stub where
// vehicles spawn or despawn. We count unique neighbors rather than incident
// edges because a bidirectional way produces two directed edges per direction,
// so a dead-end of a bidirectional road has degree 2 but only one neighbor.
export function findBoundaryEdges(
  edges: readonly Edge[],
  junctions: readonly Junction[],
): readonly EdgeId[] {
  const neighborsByJunction = new Map<number, Set<number>>();
  for (const j of junctions) neighborsByJunction.set(j.id, new Set());
  for (const e of edges) {
    neighborsByJunction.get(e.fromJunction)?.add(e.toJunction);
    neighborsByJunction.get(e.toJunction)?.add(e.fromJunction);
  }
  const boundaryJunctions = new Set<number>();
  for (const [id, neighbors] of neighborsByJunction) {
    if (neighbors.size <= 1) boundaryJunctions.add(id);
  }
  const result: EdgeId[] = [];
  for (const e of edges) {
    if (boundaryJunctions.has(e.fromJunction) || boundaryJunctions.has(e.toJunction)) {
      result.push(e.id);
    }
  }
  return result;
}
