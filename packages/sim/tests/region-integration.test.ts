import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { BoundingBox, RoadGraph } from '@traffic-lens/shared';
import { computeSabByteLength, MAX_VEHICLES, STATE_ACTIVE } from '@traffic-lens/shared';
import { World, TICK_HZ } from '../src/world.ts';
import { tick } from '../src/tick.ts';
import { clipGraph, buildDemand } from '../src/region.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAPH = JSON.parse(
  readFileSync(resolve(HERE, '../../../data/koramangala.graph.json'), 'utf8'),
) as RoadGraph;

const BBOX: BoundingBox = { minLon: 77.620, minLat: 12.930, maxLon: 77.635, maxLat: 12.945 };

describe('clipped-region simulation', () => {
  it('clips a sub-region with entries and exits and runs without NaN, within the vehicle cap', () => {
    const { graph, entryEdgeIds, exitEdgeIds } = clipGraph(GRAPH, BBOX);
    expect(entryEdgeIds.length).toBeGreaterThan(0);
    expect(exitEdgeIds.length).toBeGreaterThan(0);

    // Modest intensity for a short run; the pool-full guard itself is covered by
    // the SpawnController unit test.
    const demand = buildDemand(entryEdgeIds, exitEdgeIds, 400, 42);
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const world = World.init({ graph, demand, sab, seed: 42 });

    let everActive = 0;
    expect(() => {
      for (let i = 0; i < TICK_HZ * 15; i++) {
        tick(world);
        everActive = Math.max(everActive, world.store.activeCount());
      }
    }).not.toThrow();

    expect(everActive).toBeGreaterThan(0);
    expect(world.store.activeCount()).toBeLessThanOrEqual(MAX_VEHICLES);

    const v = world.views;
    for (let i = 0; i < MAX_VEHICLES; i++) {
      if (v.state[i] !== STATE_ACTIVE) continue;
      expect(Number.isNaN(v.posX[i])).toBe(false);
      expect(Number.isNaN(v.posY[i])).toBe(false);
    }
  });
});
