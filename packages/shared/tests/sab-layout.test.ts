import { describe, it, expect } from 'vitest';
import {
  MAX_VEHICLES,
  STATE_FREE,
  STATE_ACTIVE,
  STATE_DESPAWNING,
  computeSabByteLength,
  createSabViews,
} from '../src/sab-layout.ts';

describe('sab-layout', () => {
  it('exposes the documented constants', () => {
    expect(MAX_VEHICLES).toBe(2000);
    expect(STATE_FREE).toBe(0);
    expect(STATE_ACTIVE).toBe(1);
    expect(STATE_DESPAWNING).toBe(2);
  });

  it('createSabViews produces views with the correct lengths', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const v = createSabViews(sab);
    expect(v.control.tickNumber.length).toBe(1);
    expect(v.control.simWallClockSec.length).toBe(1);
    expect(v.posX.length).toBe(MAX_VEHICLES);
    expect(v.posY.length).toBe(MAX_VEHICLES);
    expect(v.heading.length).toBe(MAX_VEHICLES);
    expect(v.speed.length).toBe(MAX_VEHICLES);
    expect(v.accel.length).toBe(MAX_VEHICLES);
    expect(v.edgeId.length).toBe(MAX_VEHICLES);
    expect(v.edgeProgress.length).toBe(MAX_VEHICLES);
    expect(v.lane.length).toBe(MAX_VEHICLES);
    expect(v.state.length).toBe(MAX_VEHICLES);
    expect(v.vehicleType.length).toBe(MAX_VEHICLES);
    expect(v.routeIdx.length).toBe(MAX_VEHICLES);
  });

  it('field views do not overlap in the SAB', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const v = createSabViews(sab);
    // Write a sentinel into every field's slot 0; reading each back must give
    // the value that field wrote, not whatever another field clobbered into it.
    v.posX[0] = 1;
    v.posY[0] = 2;
    v.heading[0] = 3;
    v.speed[0] = 4;
    v.accel[0] = 5;
    v.edgeId[0] = 6;
    v.edgeProgress[0] = 7;
    v.lane[0] = 8;
    v.state[0] = 9;
    v.vehicleType[0] = 10;
    v.routeIdx[0] = 11;
    expect(v.posX[0]).toBe(1);
    expect(v.posY[0]).toBe(2);
    expect(v.heading[0]).toBe(3);
    expect(v.speed[0]).toBe(4);
    expect(v.accel[0]).toBe(5);
    expect(v.edgeId[0]).toBe(6);
    expect(v.edgeProgress[0]).toBe(7);
    expect(v.lane[0]).toBe(8);
    expect(v.state[0]).toBe(9);
    expect(v.vehicleType[0]).toBe(10);
    expect(v.routeIdx[0]).toBe(11);
  });

  it('writing to the last slot of one field does not leak into the next', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const v = createSabViews(sab);
    v.posX[MAX_VEHICLES - 1] = 9999;
    expect(v.posY[0]).toBe(0);
    expect(v.posY[MAX_VEHICLES - 1]).toBe(0);
  });

  it('control region is at the start of the SAB and survives view round-trip', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const a = createSabViews(sab);
    a.control.tickNumber[0] = 12345;
    a.control.simWallClockSec[0] = 3.14159;
    const b = createSabViews(sab);
    expect(b.control.tickNumber[0]).toBe(12345);
    expect(b.control.simWallClockSec[0]).toBeCloseTo(3.14159);
  });
});
