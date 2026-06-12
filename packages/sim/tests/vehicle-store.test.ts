import { describe, it, expect } from 'vitest';
import {
  computeSabByteLength,
  createSabViews,
  MAX_VEHICLES,
  STATE_ACTIVE,
  STATE_FREE,
  VEHICLE_TYPE_CAR,
} from '@traffic-lens/shared';
import { VehicleStore } from '../src/vehicle-store.ts';

function makeStore() {
  const sab = new SharedArrayBuffer(computeSabByteLength());
  const views = createSabViews(sab);
  return new VehicleStore(views);
}

const SPAWN = {
  posX: 1, posY: 2, heading: 0, speed: 5, accel: 0,
  edgeId: 100, edgeProgress: 0, lane: 0,
  vehicleType: VEHICLE_TYPE_CAR,
  route: new Uint32Array([100, 200, 300]),
};

describe('VehicleStore', () => {
  it('spawn allocates a free slot and marks it active', () => {
    const s = makeStore();
    const idx = s.spawn(SPAWN);
    expect(idx).toBe(0);
    expect(s.views.state[idx]).toBe(STATE_ACTIVE);
    expect(s.views.posX[idx]).toBe(1);
    expect(s.views.edgeId[idx]).toBe(100);
    expect(s.views.lane[idx]).toBe(0);
    expect(s.getRoute(idx)).toEqual(new Uint32Array([100, 200, 300]));
  });

  it('spawn allocates consecutive slots when no despawns yet', () => {
    const s = makeStore();
    const a = s.spawn(SPAWN);
    const b = s.spawn(SPAWN);
    const c = s.spawn(SPAWN);
    expect([a, b, c]).toEqual([0, 1, 2]);
  });

  it('despawn returns slot to free list and reuses it next spawn', () => {
    const s = makeStore();
    const a = s.spawn(SPAWN);
    const b = s.spawn(SPAWN);
    s.despawn(a);
    expect(s.views.state[a]).toBe(STATE_FREE);
    expect(s.getRoute(a)).toBeUndefined();
    const c = s.spawn(SPAWN);
    expect(c).toBe(a);
    expect(s.views.state[b]).toBe(STATE_ACTIVE);
  });

  it('throws when MAX_VEHICLES slots are exhausted', () => {
    const s = makeStore();
    for (let i = 0; i < MAX_VEHICLES; i++) s.spawn(SPAWN);
    expect(() => s.spawn(SPAWN)).toThrow(/MAX_VEHICLES/);
  });

  it('forEachActive iterates only active slots', () => {
    const s = makeStore();
    const a = s.spawn(SPAWN);
    const b = s.spawn(SPAWN);
    const c = s.spawn(SPAWN);
    s.despawn(b);
    const seen: number[] = [];
    s.forEachActive((idx) => seen.push(idx));
    expect(seen.sort()).toEqual([a, c]);
  });

  it('activeCount tracks live vehicles', () => {
    const s = makeStore();
    expect(s.activeCount()).toBe(0);
    s.spawn(SPAWN);
    s.spawn(SPAWN);
    expect(s.activeCount()).toBe(2);
    const x = s.spawn(SPAWN);
    s.despawn(x);
    expect(s.activeCount()).toBe(2);
  });
});
