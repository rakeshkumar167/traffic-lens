import type {
  Demand, DemandSource, Edge, EdgeId,
} from '@traffic-lens/shared';
import { MAX_VEHICLES, ROAD_CLASS_SPEED_MPS, VEHICLE_TYPE_CAR } from '@traffic-lens/shared';
import type { Router } from './routing.ts';
import type { VehicleStore } from './vehicle-store.ts';

const SPAWN_BLOCK_DISTANCE_M = 10;

interface ResolvedSource {
  source: DemandSource;
  spawnEdge: Edge;
  ratePerSec: number;
  cumulativeWeights: number[]; // for binary-search destination pick
  totalWeight: number;
}

export class SpawnController {
  private readonly sources: ResolvedSource[] = [];

  constructor(
    demand: Demand,
    private readonly router: Router,
    private readonly edgesById: ReadonlyMap<EdgeId, Edge>,
    private readonly rng: () => number,
  ) {
    for (const src of demand.sources) {
      const spawnEdge = edgesById.get(src.spawnEdgeId);
      if (!spawnEdge) {
        throw new Error(`SpawnController: spawnEdgeId ${src.spawnEdgeId} not in graph`);
      }
      let cumulative = 0;
      const cumulativeWeights: number[] = [];
      for (const dest of src.destinations) {
        cumulative += dest.weight;
        cumulativeWeights.push(cumulative);
      }
      this.sources.push({
        source: src,
        spawnEdge,
        ratePerSec: src.vehiclesPerHour / 3600,
        cumulativeWeights,
        totalWeight: cumulative,
      });
    }
  }

  step(dt: number, store: VehicleStore): number[] {
    const spawned: number[] = [];
    for (const rs of this.sources) {
      if (this.rng() >= rs.ratePerSec * dt) continue;
      // Pool full — drop the spawn rather than overflow the SAB slot pool.
      if (store.activeCount() >= MAX_VEHICLES) continue;
      const dest = this.pickDestination(rs);
      const route = this.router.findRoute(rs.source.spawnEdgeId, dest.exitEdgeId);
      if (!route) continue;
      if (this.spawnLaneBlocked(rs.spawnEdge, store)) continue;
      const slot = store.spawn({
        posX: rs.spawnEdge.geometry[0]!.x,
        posY: rs.spawnEdge.geometry[0]!.y,
        heading: this.headingOf(rs.spawnEdge),
        speed: ROAD_CLASS_SPEED_MPS[rs.spawnEdge.roadClass],
        accel: 0,
        edgeId: rs.source.spawnEdgeId,
        edgeProgress: 0,
        lane: 0,
        vehicleType: VEHICLE_TYPE_CAR,
        route: new Uint32Array(route),
      });
      spawned.push(slot);
    }
    return spawned;
  }

  private pickDestination(rs: ResolvedSource): { exitEdgeId: EdgeId } {
    const r = this.rng() * rs.totalWeight;
    for (let i = 0; i < rs.cumulativeWeights.length; i++) {
      if (r < rs.cumulativeWeights[i]!) {
        return rs.source.destinations[i]!;
      }
    }
    return rs.source.destinations[rs.source.destinations.length - 1]!;
  }

  private spawnLaneBlocked(spawnEdge: Edge, store: VehicleStore): boolean {
    const blockProgress = SPAWN_BLOCK_DISTANCE_M / spawnEdge.lengthM;
    const v = store.views;
    let blocked = false;
    store.forEachActive((idx) => {
      if (blocked) return;
      if (v.edgeId[idx] !== spawnEdge.id) return;
      if (v.lane[idx] !== 0) return;
      if (v.edgeProgress[idx]! < blockProgress) blocked = true;
    });
    return blocked;
  }

  private headingOf(edge: Edge): number {
    const a = edge.geometry[0]!;
    const b = edge.geometry[1]!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
}
