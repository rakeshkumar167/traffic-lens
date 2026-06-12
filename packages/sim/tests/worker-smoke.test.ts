import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import type { Demand, FromWorkerMessage, RoadGraph, ToWorkerMessage } from '@traffic-lens/shared';
import { computeSabByteLength } from '@traffic-lens/shared';
import { createWorkerDriver } from '../src/worker-driver.ts';
import { TICK_DT } from '../src/world.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAPH = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.graph.json'), 'utf8')) as RoadGraph;
const DEMAND = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.demand.json'), 'utf8')) as Demand;

describe('worker smoke (MessageChannel)', () => {
  it('drives the sim through a message channel and observes SAB advance within 2s', async () => {
    const { port1, port2 } = new MessageChannel();
    const driver = createWorkerDriver();
    const replies: FromWorkerMessage[] = [];
    port2.on('message', (msg: ToWorkerMessage) => {
      const reply = driver.handleMessage(msg);
      if (reply) port2.postMessage(reply);
    });
    port1.on('message', (msg: FromWorkerMessage) => {
      replies.push(msg);
    });

    const sab = new SharedArrayBuffer(computeSabByteLength());
    port1.postMessage({ type: 'init', graph: GRAPH, demand: DEMAND, sab });

    // Wait until `ready` is received or 2 s pass.
    const start = Date.now();
    while (!replies.some((r) => r.type === 'ready') && Date.now() - start < 2000) {
      await new Promise((r) => setImmediate(r));
    }
    expect(replies.some((r) => r.type === 'ready')).toBe(true);

    port1.postMessage({ type: 'play' });

    // Drive the runOneTick loop ourselves (in production the worker has its own interval).
    const tickEnd = Date.now() + 1500;
    while (Date.now() < tickEnd) {
      driver.runOneTick();
      await new Promise((r) => setTimeout(r, TICK_DT * 1000));
    }

    const tickView = new Uint32Array(sab, 0, 1);
    expect(tickView[0]).toBeGreaterThan(0);

    port1.close();
    port2.close();
  });
});
