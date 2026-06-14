import type {
  Edge,
  EdgeId,
  Junction,
  JunctionConnection,
  JunctionId,
  PriorityJunction,
  SignalPlan,
  SignalledJunction,
} from '@traffic-lens/shared';
import { ROAD_CLASS_PRIORITY_RANK } from '@traffic-lens/shared';
import { lonLatToWebMercator } from './project.ts';
import type { ParsedOsm } from './types.ts';

// Signals are placed structurally at real crossroads, not from OSM's
// (unreliable) stop-line `traffic_signals` tags: a junction is signalled iff it
// has at least MIN_SIGNAL_LEGS distinct neighbour legs and a biggest approach
// road of at least MIN_SIGNAL_RANK (tertiary).
const MIN_SIGNAL_LEGS = 4;
const MIN_SIGNAL_RANK = ROAD_CLASS_PRIORITY_RANK.tertiary;

export function buildJunctions(
  parsed: ParsedOsm,
  edges: readonly Edge[],
  junctionNodeIds: ReadonlySet<number>,
): readonly Junction[] {
  const incomingByJunction = new Map<JunctionId, EdgeId[]>();
  const outgoingByJunction = new Map<JunctionId, EdgeId[]>();
  for (const e of edges) {
    pushTo(incomingByJunction, e.toJunction, e.id);
    pushTo(outgoingByJunction, e.fromJunction, e.id);
  }

  const edgeById = new Map<EdgeId, Edge>();
  for (const e of edges) edgeById.set(e.id, e);

  const junctions: Junction[] = [];
  for (const nodeId of junctionNodeIds) {
    const node = parsed.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Junction node ${nodeId} not found in parsed nodes`);
    }
    const incomingEdges = incomingByJunction.get(nodeId) ?? [];
    const outgoingEdges = outgoingByJunction.get(nodeId) ?? [];
    const connections = buildConnectionTable(incomingEdges, outgoingEdges, edgeById);
    const position = lonLatToWebMercator(node.lon, node.lat);

    if (shouldSignalise(incomingEdges, outgoingEdges, edgeById)) {
      const signalled: SignalledJunction = {
        id: nodeId,
        kind: 'signalled',
        lon: node.lon,
        lat: node.lat,
        position,
        incomingEdges,
        outgoingEdges,
        connections,
        defaultSignalPlan: defaultSignalPlanFor(incomingEdges, edgeById),
      };
      junctions.push(signalled);
    } else {
      const priorityEdges = computePriorityEdges(incomingEdges, edgeById);
      const priority: PriorityJunction = {
        id: nodeId,
        kind: 'priority',
        lon: node.lon,
        lat: node.lat,
        position,
        incomingEdges,
        outgoingEdges,
        connections,
        priorityEdges,
      };
      junctions.push(priority);
    }
  }

  return junctions;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

// Default connection policy: every incoming edge connects to every outgoing edge
// except the U-turn back along the road it came from. Lane mapping uses the
// India-left-hand-traffic policy: leftmost (lane 0) feeds left-turn + straight,
// rightmost (lane numLanes-1) feeds right-turn + straight, middle lanes straight.
// For this slice we simply pair lane indices min(inLane, outLanes-1) — the
// per-lane turn restrictions ride on top later. The slice's MOBIL will
// pre-position vehicles into a valid lane before the junction.
function buildConnectionTable(
  incomingEdges: readonly EdgeId[],
  outgoingEdges: readonly EdgeId[],
  edgeById: ReadonlyMap<EdgeId, Edge>,
): JunctionConnection[] {
  const connections: JunctionConnection[] = [];
  for (const inEdgeId of incomingEdges) {
    const inEdge = edgeById.get(inEdgeId)!;
    for (const outEdgeId of outgoingEdges) {
      const outEdge = edgeById.get(outEdgeId)!;
      if (
        inEdge.fromJunction === outEdge.toJunction &&
        inEdge.toJunction === outEdge.fromJunction
      ) {
        // U-turn — not modelled in the slice.
        continue;
      }
      const lanes = Math.min(inEdge.lanes, outEdge.lanes);
      for (let lane = 0; lane < lanes; lane++) {
        connections.push({
          fromEdge: inEdgeId,
          fromLane: lane,
          toEdge: outEdgeId,
          toLane: lane,
        });
      }
    }
  }
  return connections;
}

function computePriorityEdges(
  incomingEdges: readonly EdgeId[],
  edgeById: ReadonlyMap<EdgeId, Edge>,
): EdgeId[] {
  if (incomingEdges.length === 0) return [];
  let maxRank = -Infinity;
  for (const id of incomingEdges) {
    const e = edgeById.get(id)!;
    const rank = ROAD_CLASS_PRIORITY_RANK[e.roadClass];
    if (rank > maxRank) maxRank = rank;
  }
  return incomingEdges.filter((id) => {
    const e = edgeById.get(id)!;
    return ROAD_CLASS_PRIORITY_RANK[e.roadClass] === maxRank;
  });
}

function maxApproachRank(
  incomingEdges: readonly EdgeId[],
  outgoingEdges: readonly EdgeId[],
  edgeById: ReadonlyMap<EdgeId, Edge>,
): number {
  let max = -Infinity;
  for (const id of [...incomingEdges, ...outgoingEdges]) {
    const e = edgeById.get(id);
    if (e) max = Math.max(max, ROAD_CLASS_PRIORITY_RANK[e.roadClass]);
  }
  return max;
}

function legCount(
  incomingEdges: readonly EdgeId[],
  outgoingEdges: readonly EdgeId[],
  edgeById: ReadonlyMap<EdgeId, Edge>,
): number {
  const neighbours = new Set<JunctionId>();
  for (const id of incomingEdges) neighbours.add(edgeById.get(id)!.fromJunction);
  for (const id of outgoingEdges) neighbours.add(edgeById.get(id)!.toJunction);
  return neighbours.size;
}

function shouldSignalise(
  incomingEdges: readonly EdgeId[],
  outgoingEdges: readonly EdgeId[],
  edgeById: ReadonlyMap<EdgeId, Edge>,
): boolean {
  return legCount(incomingEdges, outgoingEdges, edgeById) >= MIN_SIGNAL_LEGS
    && maxApproachRank(incomingEdges, outgoingEdges, edgeById) >= MIN_SIGNAL_RANK;
}

// Green seconds per phase, scaled by the junction's biggest approach road class
// (bigger/arterial junctions get longer greens).
export function greenSecForRank(rank: number): number {
  if (rank >= ROAD_CLASS_PRIORITY_RANK.primary) return 45;
  if (rank >= ROAD_CLASS_PRIORITY_RANK.secondary) return 35;
  if (rank >= ROAD_CLASS_PRIORITY_RANK.tertiary) return 25;
  return 20;
}

// Bearing (radians) of an edge's final segment, i.e. its direction into the
// junction at the `to` end.
function approachBearing(edge: Edge): number {
  const g = edge.geometry;
  const a = g[g.length - 2] ?? g[0]!;
  const b = g[g.length - 1]!;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// Split incoming approaches into two phases by bearing axis: opposing approaches
// (≈180° apart → same axis mod 180°) share a phase, giving "NS-green then
// EW-green". Phase A = approaches within 45° of the first approach's axis.
export function groupApproachesByAxis(
  incomingEdges: readonly EdgeId[],
  edgeById: ReadonlyMap<EdgeId, Edge>,
): [EdgeId[], EdgeId[]] {
  const phaseA: EdgeId[] = [];
  const phaseB: EdgeId[] = [];
  if (incomingEdges.length === 0) return [phaseA, phaseB];

  const axisOf = (id: EdgeId): number => {
    let ax = approachBearing(edgeById.get(id)!) % Math.PI;
    if (ax < 0) ax += Math.PI; // fold to [0, π)
    return ax;
  };
  const ref = axisOf(incomingEdges[0]!);
  for (const id of incomingEdges) {
    let d = Math.abs(axisOf(id) - ref);
    if (d > Math.PI / 2) d = Math.PI - d; // axis distance folds to [0, π/2]
    if (d <= Math.PI / 4) phaseA.push(id);
    else phaseB.push(id);
  }
  return [phaseA, phaseB];
}

function defaultSignalPlanFor(
  incomingEdges: readonly EdgeId[],
  edgeById: ReadonlyMap<EdgeId, Edge>,
): SignalPlan {
  if (incomingEdges.length === 0) return { cycleSec: 0, phases: [] };
  const [phaseA, phaseB] = groupApproachesByAxis(incomingEdges, edgeById);
  let maxRank = -Infinity;
  for (const id of incomingEdges) {
    maxRank = Math.max(maxRank, ROAD_CLASS_PRIORITY_RANK[edgeById.get(id)!.roadClass]);
  }
  const green = greenSecForRank(maxRank);
  const phases = phaseB.length === 0
    ? [{ greenIncomingEdges: phaseA, durationSec: green }]
    : [
        { greenIncomingEdges: phaseA, durationSec: green },
        { greenIncomingEdges: phaseB, durationSec: green },
      ];
  const cycleSec = phases.reduce((s, p) => s + p.durationSec, 0);
  return { cycleSec, phases };
}
