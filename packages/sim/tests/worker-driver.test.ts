import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Demand, RoadGraph } from '@traffic-lens/shared';
import { computeSabByteLength } from '@traffic-lens/shared';
import { createWorkerDriver } from '../src/worker-driver.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAPH = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.graph.json'), 'utf8')) as RoadGraph;
const DEMAND = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.demand.json'), 'utf8')) as Demand;

describe('worker-driver', () => {
  it('init returns ready and accepts subsequent control messages', () => {
    const d = createWorkerDriver();
    const sab = new SharedArrayBuffer(computeSabByteLength());
    expect(d.handleMessage({ type: 'init', graph: GRAPH, demand: DEMAND, sab }))
      .toEqual({ type: 'ready' });
    expect(d.handleMessage({ type: 'play' })).toBeNull();
    expect(d.isRunning()).toBe(true);
    expect(d.handleMessage({ type: 'pause' })).toBeNull();
    expect(d.isRunning()).toBe(false);
  });

  it('step advances the tick number by one', () => {
    const d = createWorkerDriver();
    const sab = new SharedArrayBuffer(computeSabByteLength());
    d.handleMessage({ type: 'init', graph: GRAPH, demand: DEMAND, sab });
    const before = new Uint32Array(sab, 0, 1)[0]!;
    d.handleMessage({ type: 'step' });
    const after = new Uint32Array(sab, 0, 1)[0]!;
    expect(after).toBe(before + 1);
  });

  it('rejects play before init with an error message', () => {
    const d = createWorkerDriver();
    const result = d.handleMessage({ type: 'play' });
    expect(result).toMatchObject({ type: 'error' });
  });

  it('rejects setSpeed with non-positive multiplier', () => {
    const d = createWorkerDriver();
    const sab = new SharedArrayBuffer(computeSabByteLength());
    d.handleMessage({ type: 'init', graph: GRAPH, demand: DEMAND, sab });
    const result = d.handleMessage({ type: 'setSpeed', multiplier: 0 });
    expect(result).toMatchObject({ type: 'error' });
  });

  it('runOneTick is a no-op when paused', () => {
    const d = createWorkerDriver();
    const sab = new SharedArrayBuffer(computeSabByteLength());
    d.handleMessage({ type: 'init', graph: GRAPH, demand: DEMAND, sab });
    const before = new Uint32Array(sab, 0, 1)[0]!;
    d.runOneTick();
    expect(new Uint32Array(sab, 0, 1)[0]!).toBe(before);
  });
});
