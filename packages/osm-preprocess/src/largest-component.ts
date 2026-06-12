import type { Edge, Junction, JunctionId } from '@traffic-lens/shared';

export interface PruneResult {
  readonly edges: readonly Edge[];
  readonly junctions: readonly Junction[];
  readonly droppedEdgeCount: number;
  readonly droppedJunctionCount: number;
}

// Return the largest weakly-connected component of the given (edges, junctions)
// graph, plus counts of what was dropped. Junctions outside the largest
// component are removed; edges with either endpoint outside it are removed.
// If the graph has zero junctions, returns it unchanged.
export function pruneToLargestComponent(
  edges: readonly Edge[],
  junctions: readonly Junction[],
): PruneResult {
  if (junctions.length === 0) {
    return { edges, junctions, droppedEdgeCount: 0, droppedJunctionCount: 0 };
  }

  // Build undirected adjacency.
  const adj = new Map<JunctionId, Set<JunctionId>>();
  for (const j of junctions) adj.set(j.id, new Set());
  for (const e of edges) {
    adj.get(e.fromJunction)?.add(e.toJunction);
    adj.get(e.toJunction)?.add(e.fromJunction);
  }

  // BFS each component, tracking the largest.
  const visited = new Set<JunctionId>();
  let largest: Set<JunctionId> = new Set();
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const component = new Set<JunctionId>();
    const queue: JunctionId[] = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      component.add(cur);
      for (const next of adj.get(cur) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
    }
    if (component.size > largest.size) largest = component;
  }

  const keptJunctions = junctions.filter((j) => largest.has(j.id));
  const keptEdges = edges.filter(
    (e) => largest.has(e.fromJunction) && largest.has(e.toJunction),
  );
  return {
    edges: keptEdges,
    junctions: keptJunctions,
    droppedEdgeCount: edges.length - keptEdges.length,
    droppedJunctionCount: junctions.length - keptJunctions.length,
  };
}
