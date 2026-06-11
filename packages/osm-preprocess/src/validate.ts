import type { RoadGraph } from '@traffic-lens/shared';

export function validateRoadGraph(graph: RoadGraph): void {
  const errors: string[] = [];
  const junctionIds = new Set(graph.junctions.map((j) => j.id));

  for (const e of graph.edges) {
    if (e.lengthM <= 0 || !Number.isFinite(e.lengthM)) {
      errors.push(`Edge ${e.id} has zero length`);
    }
    if (!junctionIds.has(e.fromJunction)) {
      errors.push(`Edge ${e.id} references missing junction ${e.fromJunction}`);
    }
    if (!junctionIds.has(e.toJunction)) {
      errors.push(`Edge ${e.id} references missing junction ${e.toJunction}`);
    }
    if (e.lanes <= 0) {
      errors.push(`Edge ${e.id} has non-positive lane count ${e.lanes}`);
    }
  }

  for (const j of graph.junctions) {
    if (j.kind === 'signalled' && j.incomingEdges.length === 0) {
      errors.push(`Signal junction ${j.id} has zero incoming edges`);
    }
  }

  if (!isWeaklyConnected(graph)) {
    errors.push('Graph is not weakly connected');
  }

  if (errors.length > 0) {
    throw new Error(`RoadGraph validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

function isWeaklyConnected(graph: RoadGraph): boolean {
  if (graph.junctions.length === 0) return true;
  const adj = new Map<number, Set<number>>();
  for (const j of graph.junctions) adj.set(j.id, new Set());
  for (const e of graph.edges) {
    adj.get(e.fromJunction)?.add(e.toJunction);
    adj.get(e.toJunction)?.add(e.fromJunction);
  }
  const seen = new Set<number>();
  const start = graph.junctions[0]!.id;
  const queue: number[] = [start];
  seen.add(start);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size === graph.junctions.length;
}
