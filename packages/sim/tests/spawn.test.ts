import { describe, it, expect } from 'vitest';
import {
  computeSabByteLength,
  createSabViews,
  MAX_VEHICLES,
  ROAD_CLASS_SPEED_MPS,
  VEHICLE_TYPE_CAR,
} from '@traffic-lens/shared';
import type { Demand, Edge, RoadGraph } from '@traffic-lens/shared';
import { VehicleStore } from '../src/vehicle-store.ts';
import { Router } from '../src/routing.ts';
import { SpawnController } from '../src/spawn.ts';

function edge(id: number, from: number, to: number, lengthM: number): Edge {
  return {
    id, fromJunction: from, toJunction: to,
    geometry: [{ x: from, y: 0 }, { x: to, y: 0 }],
    lengthM, lanes: 1, roadClass: 'residential', oneway: true,
  };
}

const META = {
  bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
  projection: 'webMercator' as const,
  generatedAt: '', sourceHash: '', scriptVersion: '',
};

const GRAPH: RoadGraph = {
  meta: META,
  edges: [edge(10, 1, 2, 100), edge(20, 2, 3, 100)],
  junctions: [],
  boundaryEdges: [10, 20],
};

const DEMAND: Demand = {
  seed: 42,
  durationSec: 60,
  sources: [{
    id: 'src',
    spawnEdgeId: 10,
    vehiclesPerHour: 3600, // 1 per sim-second
    destinations: [{ exitEdgeId: 20, weight: 1 }],
  }],
};

function makeWorld() {
  const sab = new SharedArrayBuffer(computeSabByteLength());
  const views = createSabViews(sab);
  const store = new VehicleStore(views);
  const router = new Router(GRAPH);
  const edgesById = new Map(GRAPH.edges.map((e) => [e.id, e]));
  return { store, router, edgesById };
}

describe('SpawnController', () => {
  it('emits spawns at roughly the configured rate over many ticks', () => {
    const { store, router, edgesById } = makeWorld();
    const rng = (() => { let s = 42; return () => { s = (s + 1) | 0; return ((s * 2654435761) >>> 0) / 4294967296; }; })();
    const ctrl = new SpawnController(DEMAND, router, edgesById, rng);
    const dt = 1 / 30;
    let count = 0;
    for (let i = 0; i < 30 * 60; i++) { // 60 sim-seconds at 30 Hz
      const spawned = ctrl.step(dt, store);
      count += spawned.length;
      // Despawn immediately so the spawn lane stays clear (this test isolates
      // the rate sampling from the block-check; the block-check has its own test).
      for (const slot of spawned) store.despawn(slot);
    }
    // Expected ~60 spawns; allow wide statistical tolerance.
    expect(count).toBeGreaterThan(30);
    expect(count).toBeLessThan(120);
  });

  it('initializes a spawned vehicle on the spawn edge with valid route', () => {
    const { store, router, edgesById } = makeWorld();
    const rng = () => 0.0; // forces "spawn this tick"
    const ctrl = new SpawnController(DEMAND, router, edgesById, rng);
    const spawned = ctrl.step(0.5, store);
    expect(spawned.length).toBe(1);
    const slot = spawned[0]!;
    expect(store.views.edgeId[slot]).toBe(10);
    expect(store.views.lane[slot]).toBe(0);
    expect(store.views.edgeProgress[slot]).toBe(0);
    expect(store.views.vehicleType[slot]).toBe(VEHICLE_TYPE_CAR);
    expect(store.views.speed[slot]).toBeCloseTo(ROAD_CLASS_SPEED_MPS.residential, 5);
    expect(store.getRoute(slot)).toEqual(new Uint32Array([10, 20]));
  });

  it('skips spawning without throwing when the vehicle pool is full', () => {
    const { store, router, edgesById } = makeWorld();
    // Fill every slot with vehicles past the spawn-block zone (progress 0.5 of
    // 100 m = 50 m, well beyond the 10 m block distance) so the lane is clear
    // and only the pool-full condition can stop a spawn.
    for (let i = 0; i < MAX_VEHICLES; i++) {
      store.spawn({
        posX: 0, posY: 0, heading: 0, speed: 0, accel: 0,
        edgeId: 10, edgeProgress: 0.5, lane: 0,
        vehicleType: VEHICLE_TYPE_CAR, route: new Uint32Array([10, 20]),
      });
    }
    const rng = () => 0.0; // forces "would spawn"
    const ctrl = new SpawnController(DEMAND, router, edgesById, rng);
    let spawned: number[] = [];
    expect(() => { spawned = ctrl.step(0.5, store); }).not.toThrow();
    expect(spawned).toEqual([]);
  });

  it('holds the spawn when the spawn lane is blocked within 10 m', () => {
    const { store, router, edgesById } = makeWorld();
    // Pre-occupy slot 0 on the spawn edge at progress 0.05 (5 m of 100 m).
    store.spawn({
      posX: 5, posY: 0, heading: 0, speed: 0, accel: 0,
      edgeId: 10, edgeProgress: 0.05, lane: 0,
      vehicleType: VEHICLE_TYPE_CAR, route: new Uint32Array([10, 20]),
    });
    const rng = () => 0.0; // forces "would spawn"
    const ctrl = new SpawnController(DEMAND, router, edgesById, rng);
    const spawned = ctrl.step(0.5, store);
    expect(spawned.length).toBe(0); // blocked
  });
});
