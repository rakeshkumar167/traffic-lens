import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Demand, RoadGraph } from '@traffic-lens/shared';
import { computeSabByteLength } from '@traffic-lens/shared';
import { World, TICK_HZ } from '../src/world.ts';
import { tick } from '../src/tick.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAPH = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.graph.json'), 'utf8')) as RoadGraph;
const DEMAND = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.demand.json'), 'utf8')) as Demand;

function runForTicks(seed: number, ticks: number): Uint8Array {
  const sab = new SharedArrayBuffer(computeSabByteLength());
  const world = World.init({ graph: GRAPH, demand: DEMAND, sab, seed });
  for (let i = 0; i < ticks; i++) tick(world);
  return new Uint8Array(sab.slice(0));
}

describe('determinism', () => {
  it('two runs with the same seed produce byte-identical SAB after 60 sim-seconds', () => {
    const ticks = TICK_HZ * 60;
    const a = runForTicks(42, ticks);
    const b = runForTicks(42, ticks);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        throw new Error(`SAB byte ${i} differs: ${a[i]} vs ${b[i]}`);
      }
    }
  });

  it('different seeds produce different SAB state', () => {
    const ticks = TICK_HZ * 30;
    const a = runForTicks(42, ticks);
    const b = runForTicks(43, ticks);
    let diffs = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
    expect(diffs).toBeGreaterThan(0);
  });
});
