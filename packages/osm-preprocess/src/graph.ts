import type {
  Edge,
  EdgeId,
  JunctionId,
  Point2D,
  RoadClass,
} from '@traffic-lens/shared';
import { ROAD_CLASS_DEFAULT_LANES } from '@traffic-lens/shared';
import { lonLatToWebMercator } from './project.ts';
import type { OsmNode, OsmWay, ParsedOsm } from './types.ts';

export interface BuildEdgesResult {
  // Edges produced, with stable ids assigned in iteration order.
  readonly edges: readonly Edge[];
  // The set of OSM node ids that are junctions (≥2 drivable ways through them,
  // OR are way endpoints — endpoints are always junctions even if degree 1).
  readonly junctionNodeIds: ReadonlySet<number>;
}

export function buildEdges(parsed: ParsedOsm): BuildEdgesResult {
  const junctionNodeIds = findJunctionNodes(parsed.drivableWays);
  let nextEdgeId: EdgeId = 0;
  const edges: Edge[] = [];

  for (const way of parsed.drivableWays) {
    const roadClass = way.tags['highway'] as RoadClass;
    const oneway = way.tags['oneway'] === 'yes';
    const explicitLanes = way.tags['lanes'] !== undefined
      ? Number.parseInt(way.tags['lanes'], 10)
      : undefined;
    const lanes = Number.isFinite(explicitLanes) && (explicitLanes as number) > 0
      ? (explicitLanes as number)
      : ROAD_CLASS_DEFAULT_LANES[roadClass];

    // Walk the way, splitting it at every junction node into edge segments.
    const segments = splitWayAtJunctions(way, junctionNodeIds);
    for (const seg of segments) {
      const fromJunction = seg[0]! as JunctionId;
      const toJunction = seg[seg.length - 1]! as JunctionId;
      const geometry = projectNodes(seg, parsed.nodes);
      const lengthM = polylineLengthM(geometry);

      edges.push({
        id: nextEdgeId++,
        fromJunction,
        toJunction,
        geometry,
        lengthM,
        lanes,
        roadClass,
        oneway,
      });
      if (!oneway) {
        const reverseGeometry = [...geometry].reverse();
        edges.push({
          id: nextEdgeId++,
          fromJunction: toJunction,
          toJunction: fromJunction,
          geometry: reverseGeometry,
          lengthM,
          lanes,
          roadClass,
          oneway: false,
        });
      }
    }
  }

  return { edges, junctionNodeIds };
}

function findJunctionNodes(ways: readonly OsmWay[]): Set<number> {
  const degree = new Map<number, number>();
  for (const way of ways) {
    // Way endpoints always count as junction candidates.
    for (const nodeId of way.nodeRefs) {
      degree.set(nodeId, (degree.get(nodeId) ?? 0) + 1);
    }
  }
  const junctions = new Set<number>();
  for (const [nodeId, d] of degree) {
    if (d >= 2) junctions.add(nodeId);
  }
  // Also include way endpoints with degree 1 — they are network-boundary
  // junctions (where vehicles will spawn/despawn).
  for (const way of ways) {
    const first = way.nodeRefs[0];
    const last = way.nodeRefs[way.nodeRefs.length - 1];
    if (first !== undefined) junctions.add(first);
    if (last !== undefined) junctions.add(last);
  }
  return junctions;
}

function splitWayAtJunctions(
  way: OsmWay,
  junctionNodeIds: ReadonlySet<number>,
): number[][] {
  const segments: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < way.nodeRefs.length; i++) {
    const nodeId = way.nodeRefs[i]!;
    current.push(nodeId);
    const isLast = i === way.nodeRefs.length - 1;
    if (current.length > 1 && (junctionNodeIds.has(nodeId) || isLast)) {
      segments.push(current);
      current = [nodeId];
    }
  }
  return segments;
}

function projectNodes(
  nodeIds: readonly number[],
  nodes: ReadonlyMap<number, OsmNode>,
): Point2D[] {
  return nodeIds.map((id) => {
    const n = nodes.get(id);
    if (!n) throw new Error(`Missing node ${id} referenced by a way`);
    return lonLatToWebMercator(n.lon, n.lat);
  });
}

function polylineLengthM(points: readonly Point2D[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    total += Math.hypot(dx, dy);
  }
  return total;
}
