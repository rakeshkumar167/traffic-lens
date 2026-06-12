import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseOsmFile } from '../src/parse.ts';
import { buildEdges } from '../src/graph.ts';

const here = dirname(fileURLToPath(import.meta.url));
const TINY_FIXTURE = join(here, 'fixtures', 'tiny.osm');

describe('buildEdges (tiny.osm fixture)', () => {
  it('produces 8 directed edges from the fixture', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges } = buildEdges(parsed);
    expect(edges.length).toBe(8);
  });

  it('respects oneway=yes on way 101', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges } = buildEdges(parsed);
    const onewayEdges = edges.filter((e) => e.oneway);
    // Way 101 contributes 2 directed edges (2→3 and 3→5), both oneway.
    expect(onewayEdges.length).toBe(2);
    expect(onewayEdges.every((e) => e.roadClass === 'secondary')).toBe(true);
  });

  it('uses explicit lanes tag when present', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges } = buildEdges(parsed);
    const secondaryEdges = edges.filter((e) => e.roadClass === 'secondary');
    expect(secondaryEdges.every((e) => e.lanes === 3)).toBe(true);
  });

  it('falls back to road-class default lanes when tag absent', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges } = buildEdges(parsed);
    const primaryEdges = edges.filter((e) => e.roadClass === 'primary');
    expect(primaryEdges.every((e) => e.lanes === 3)).toBe(true);
    const residentialEdges = edges.filter((e) => e.roadClass === 'residential');
    expect(residentialEdges.every((e) => e.lanes === 1)).toBe(true);
  });

  it('computes positive edge lengths', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges } = buildEdges(parsed);
    expect(edges.every((e) => e.lengthM > 0)).toBe(true);
  });

  it('paired bidirectional edges have equal length', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges } = buildEdges(parsed);
    // Match each forward edge with its reverse by (fromJunction, toJunction).
    const lengthByPair = new Map<string, number>();
    for (const e of edges) {
      const key = `${e.fromJunction}->${e.toJunction}`;
      lengthByPair.set(key, e.lengthM);
    }
    for (const e of edges) {
      if (e.oneway) continue;
      const reverseKey = `${e.toJunction}->${e.fromJunction}`;
      const reverseLength = lengthByPair.get(reverseKey);
      expect(reverseLength).toBeDefined();
      expect(reverseLength).toBeCloseTo(e.lengthM, 6);
    }
  });

  it('promotes mid-way traffic-signal nodes to junctions', async () => {
    // Build a minimal in-memory fixture where a single way (no other way
    // shares any node) contains a mid-way signal node. The signal node must
    // become a junction so the way splits there.
    const nodes = new Map([
      [10, { id: 10, lon: 77.62, lat: 12.93, tags: {} }],
      [11, { id: 11, lon: 77.62, lat: 12.935,
             tags: { highway: 'traffic_signals' } }],
      [12, { id: 12, lon: 77.62, lat: 12.94, tags: {} }],
    ]);
    const drivableWays = [{
      id: 200,
      nodeRefs: [10, 11, 12],
      tags: { highway: 'primary' },
    }];
    const { edges } = buildEdges({ nodes, drivableWays });
    // The way is bidirectional + has 1 internal junction (node 11), so it
    // produces 2 segments × 2 directions = 4 directed edges.
    expect(edges.length).toBe(4);
    // Every edge endpoint set should include node 11 (the signal).
    const endpoints = new Set<number>();
    for (const e of edges) {
      endpoints.add(e.fromJunction);
      endpoints.add(e.toJunction);
    }
    expect(endpoints.has(11)).toBe(true);
  });
});
