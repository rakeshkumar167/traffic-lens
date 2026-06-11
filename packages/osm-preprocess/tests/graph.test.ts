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
});
