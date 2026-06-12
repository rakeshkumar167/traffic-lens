import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Demand, RoadGraph } from '@traffic-lens/shared';
import { computeSabByteLength, MAX_VEHICLES, STATE_ACTIVE } from '@traffic-lens/shared';
import { World, TICK_HZ } from '../src/world.ts';
import { tick } from '../src/tick.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAPH = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.graph.json'), 'utf8')) as RoadGraph;
const DEMAND = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.demand.json'), 'utf8')) as Demand;

describe('tick integration on Koramangala', () => {
  it('runs 60 sim-seconds without crashing or producing NaN', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const world = World.init({ graph: GRAPH, demand: DEMAND, sab, seed: 42 });
    const ticks = TICK_HZ * 60;
    for (let i = 0; i < ticks; i++) tick(world);

    const v = world.views;
    for (let i = 0; i < MAX_VEHICLES; i++) {
      if (v.state[i] !== STATE_ACTIVE) continue;
      expect(Number.isNaN(v.posX[i])).toBe(false);
      expect(Number.isNaN(v.posY[i])).toBe(false);
      expect(Number.isNaN(v.speed[i])).toBe(false);
      expect(v.speed[i]).toBeGreaterThanOrEqual(-0.01);
    }
    expect(v.control.tickNumber[0]).toBe(ticks);
    expect(v.control.simWallClockSec[0]).toBeCloseTo(60, 1);
  });

  it('produces some active vehicles within the first 30 sim-seconds', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const world = World.init({ graph: GRAPH, demand: DEMAND, sab, seed: 42 });
    for (let i = 0; i < TICK_HZ * 30; i++) tick(world);
    expect(world.store.activeCount()).toBeGreaterThan(0);
  });

  it('after 180 sim-seconds, vehicles have despawned (routes complete)', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const world = World.init({ graph: GRAPH, demand: DEMAND, sab, seed: 42 });
    let everSpawned = 0;
    let endActive = 0;
    for (let i = 0; i < TICK_HZ * 180; i++) {
      const before = world.store.activeCount();
      tick(world);
      const after = world.store.activeCount();
      if (after > before) everSpawned += after - before;
      endActive = after;
    }
    expect(everSpawned).toBeGreaterThan(0);
    // Active count after 3 minutes should be less than the cumulative number
    // ever spawned — i.e. vehicles ARE despawning.
    expect(endActive).toBeLessThan(everSpawned);
  });
});
