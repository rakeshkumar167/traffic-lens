import type {
  Demand, Edge, EdgeId, Junction, JunctionId, RoadGraph, SignalledJunction,
} from '@traffic-lens/shared';
import { createSabViews, type SabViews } from '@traffic-lens/shared';
import { Router } from './routing.ts';
import { VehicleStore } from './vehicle-store.ts';
import { PerceptionIndex } from './perception.ts';
import { buildEdgePolylines, type EdgePolyline } from './geometry.ts';
import { buildJunctionBoxes, exitDistance, type JunctionBoxes } from './junction-box.ts';
import { SpawnController } from './spawn.ts';
import { JUNCTION_STOP_GAP_M, VEHICLE_LENGTH_M } from '@traffic-lens/shared';
import { createRng } from './prng.ts';
import { createSignalState, type SignalState } from './signals.ts';
import { DEFAULT_IDM_PARAMS, type IdmParams } from './idm.ts';
import { DEFAULT_MOBIL_PARAMS, type MobilParams } from './mobil.ts';
import { DEFAULT_PRIORITY_PARAMS, type PriorityParams } from './priority.ts';

export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

export interface WorldInit {
  graph: RoadGraph;
  demand: Demand;
  sab: SharedArrayBuffer;
  seed?: number;
}

export class World {
  graph!: RoadGraph;
  demand!: Demand;
  views!: SabViews;
  rng!: () => number;
  router!: Router;
  store!: VehicleStore;
  perception!: PerceptionIndex;
  spawnController!: SpawnController;
  edgesById!: Map<EdgeId, Edge>;
  edgePolylines!: Map<EdgeId, EdgePolyline>;
  junctionBoxes!: JunctionBoxes;
  // Distance (m) from the junction node back to a stopped car's centre, so its
  // front bumper rests JUNCTION_STOP_GAP_M behind the junction box. Keyed by the
  // incoming edge. Absent for edges not approaching a signalled junction.
  edgeStopDist!: Map<EdgeId, number>;
  junctionsById!: Map<JunctionId, Junction>;
  signalStates!: Map<JunctionId, SignalState>;
  signalPlans!: Map<JunctionId, SignalledJunction>;
  idmParams: IdmParams = DEFAULT_IDM_PARAMS;
  mobilParams: MobilParams = DEFAULT_MOBIL_PARAMS;
  priorityParams: PriorityParams = DEFAULT_PRIORITY_PARAMS;

  static init({ graph, demand, sab, seed }: WorldInit): World {
    const w = new World();
    w.graph = graph;
    w.demand = demand;
    w.views = createSabViews(sab);
    w.rng = createRng(seed ?? demand.seed);
    w.router = new Router(graph);
    w.store = new VehicleStore(w.views);
    w.perception = new PerceptionIndex();
    w.edgesById = new Map(graph.edges.map((e) => [e.id, e]));
    w.edgePolylines = buildEdgePolylines(graph.edges);
    w.junctionBoxes = buildJunctionBoxes(graph);
    w.edgeStopDist = computeEdgeStopDistances(graph, w.junctionBoxes);
    w.junctionsById = new Map(graph.junctions.map((j) => [j.id, j]));
    w.signalStates = new Map();
    w.signalPlans = new Map();
    for (const j of graph.junctions) {
      if (j.kind === 'signalled') {
        w.signalStates.set(j.id, createSignalState());
        w.signalPlans.set(j.id, j);
      }
    }
    w.spawnController = new SpawnController(demand, w.router, w.edgesById, w.rng);
    return w;
  }
}

// For every edge approaching a signalled junction, the distance from the
// junction node back to where a stopped car's *centre* must sit so its front
// bumper rests JUNCTION_STOP_GAP_M behind the junction box boundary along that
// approach.
function computeEdgeStopDistances(graph: RoadGraph, boxes: JunctionBoxes): Map<EdgeId, number> {
  const out = new Map<EdgeId, number>();
  for (const e of graph.edges) {
    const box = boxes.byJunction.get(e.toJunction);
    if (!box) continue;
    const g = e.geometry;
    const n = g.length;
    if (n < 2) continue;
    const node = g[n - 1]!;       // edge ends at the junction node
    const prev = g[n - 2]!;
    const dx = node.x - prev.x;   // travel direction toward the node
    const dy = node.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    // Walk backwards (away from the junction) to the box boundary.
    const exit = exitDistance(box, node.x, node.y, -dx / len, -dy / len);
    out.set(e.id, exit + JUNCTION_STOP_GAP_M + VEHICLE_LENGTH_M / 2);
  }
  return out;
}
