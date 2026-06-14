import { describe, it, expect } from 'vitest';
import {
  computeSabByteLength,
  createSabViews,
  VEHICLE_TYPE_CAR,
  VEHICLE_LENGTH_M,
} from '@traffic-lens/shared';
import type { Edge } from '@traffic-lens/shared';
import { VehicleStore } from '../src/vehicle-store.ts';
import { PerceptionIndex } from '../src/perception.ts';

function edge(id: number, lanes: number, lengthM: number): Edge {
  return {
    id, fromJunction: 1, toJunction: 2,
    geometry: [{ x: 0, y: 0 }, { x: lengthM, y: 0 }],
    lengthM, lanes, roadClass: 'residential', oneway: true,
  };
}

function makeStore() {
  const sab = new SharedArrayBuffer(computeSabByteLength());
  return new VehicleStore(createSabViews(sab));
}

function spawn(store: VehicleStore, edgeId: number, lane: number, edgeProgress: number) {
  return store.spawn({
    posX: 0, posY: 0, heading: 0, speed: 5, accel: 0,
    edgeId, edgeProgress, lane,
    vehicleType: VEHICLE_TYPE_CAR,
    route: new Uint32Array([edgeId]),
  });
}

describe('PerceptionIndex', () => {
  it('finds the immediate leader on the same lane', () => {
    const store = makeStore();
    const e = edge(7, 2, 100);
    const a = spawn(store, 7, 0, 0.2);
    const b = spawn(store, 7, 0, 0.5);
    spawn(store, 7, 1, 0.4); // different lane, not a leader

    const idx = new PerceptionIndex();
    idx.rebuild(store, new Map([[7, e]]));

    const leader = idx.findLeader(7, 0, 0.2);
    expect(leader).not.toBeNull();
    expect(leader!.slotIdx).toBe(b);
    // Centre-to-centre = (0.5 - 0.2) * 100 = 30 m; the reported gap is
    // bumper-to-bumper, i.e. minus one vehicle length.
    expect(leader!.gapM).toBeCloseTo(30 - VEHICLE_LENGTH_M, 5);
    expect(idx.findLeader(7, 0, 0.5)).toBeNull();
  });

  it('returns null when no vehicles share the edge', () => {
    const store = makeStore();
    const e = edge(7, 1, 100);
    spawn(store, 99, 0, 0.5); // different edge
    const idx = new PerceptionIndex();
    idx.rebuild(store, new Map([[7, e], [99, edge(99, 1, 100)]]));
    expect(idx.findLeader(7, 0, 0.0)).toBeNull();
  });

  it('handles many vehicles on one edge and finds nearest in front', () => {
    const store = makeStore();
    const e = edge(7, 1, 100);
    const slots: number[] = [];
    for (let i = 0; i < 10; i++) slots.push(spawn(store, 7, 0, i / 10));
    const idx = new PerceptionIndex();
    idx.rebuild(store, new Map([[7, e]]));
    const leader = idx.findLeader(7, 0, 0.45);
    expect(leader!.slotIdx).toBe(slots[5]);
    // Centre-to-centre is 5 m — less than a vehicle length — so the
    // bumper-to-bumper gap clamps to 0 (treated as an overlap / hard stop).
    expect(leader!.gapM).toBeCloseTo(Math.max(0, 5 - VEHICLE_LENGTH_M), 5);
  });

  it('findTrailing returns the lowest-progress vehicle in a lane', () => {
    const store = makeStore();
    const e = edge(7, 1, 100);
    const tail = spawn(store, 7, 0, 0.1);
    spawn(store, 7, 0, 0.6);
    spawn(store, 7, 0, 0.9);
    const idx = new PerceptionIndex();
    idx.rebuild(store, new Map([[7, e]]));

    const trailing = idx.findTrailing(7, 0);
    expect(trailing).not.toBeNull();
    expect(trailing!.slotIdx).toBe(tail);
    expect(trailing!.progress).toBeCloseTo(0.1, 5);

    expect(idx.findTrailing(7, 1)).toBeNull(); // empty lane
    expect(idx.findTrailing(999, 0)).toBeNull(); // unknown edge
  });
});
