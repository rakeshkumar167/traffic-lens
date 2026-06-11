import type { RoadGraph } from '@traffic-lens/shared';

// Serialize a RoadGraph to a stable JSON string. Object key order follows the
// type definition order; arrays preserve insertion order. We pretty-print with
// 2-space indent so committed snapshot diffs are reviewable.
export function emitRoadGraphJson(graph: RoadGraph): string {
  return JSON.stringify(graph, null, 2) + '\n';
}
