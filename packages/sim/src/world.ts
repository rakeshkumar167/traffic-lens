import type {
  Demand, Edge, EdgeId, Junction, JunctionId, RoadGraph, SignalledJunction,
} from '@traffic-lens/shared';
import { createSabViews, type SabViews } from '@traffic-lens/shared';
import { Router } from './routing.ts';
import { VehicleStore } from './vehicle-store.ts';
import { PerceptionIndex } from './perception.ts';
import { SpawnController } from './spawn.ts';
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
