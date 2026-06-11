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

const DEFAULT_SIGNAL_CYCLE_SEC = 60;
const DEFAULT_SIGNAL_PHASE_SEC = 30;

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
    if (!node) continue;
    const incomingEdges = incomingByJunction.get(nodeId) ?? [];
    const outgoingEdges = outgoingByJunction.get(nodeId) ?? [];
    const connections = buildConnectionTable(incomingEdges, outgoingEdges, edgeById);
    const position = lonLatToWebMercator(node.lon, node.lat);

    const hasSignalTag = node.tags['highway'] === 'traffic_signals';
    if (hasSignalTag) {
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

function defaultSignalPlanFor(
  incomingEdges: readonly EdgeId[],
  _edgeById: ReadonlyMap<EdgeId, Edge>,
): SignalPlan {
  if (incomingEdges.length === 0) {
    return { cycleSec: DEFAULT_SIGNAL_CYCLE_SEC, phases: [] };
  }
  // Slice default: two phases, each holding half the incoming edges green.
  // For 4-way junctions this approximates "NS-green then EW-green". For more
  // exotic counts it still produces a valid round-robin that the sim can run.
  const half = Math.ceil(incomingEdges.length / 2);
  const phaseA = incomingEdges.slice(0, half);
  const phaseB = incomingEdges.slice(half);
  const phases = phaseB.length === 0
    ? [{ greenIncomingEdges: phaseA, durationSec: DEFAULT_SIGNAL_CYCLE_SEC }]
    : [
        { greenIncomingEdges: phaseA, durationSec: DEFAULT_SIGNAL_PHASE_SEC },
        { greenIncomingEdges: phaseB, durationSec: DEFAULT_SIGNAL_PHASE_SEC },
      ];
  const cycleSec = phases.reduce((s, p) => s + p.durationSec, 0);
  return { cycleSec, phases };
}
