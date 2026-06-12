import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Demand } from '../src/demand.ts';
import { validateDemand } from '../src/demand.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMAND_PATH = resolve(HERE, '../../../data/koramangala.demand.json');
const GRAPH_PATH = resolve(HERE, '../../../data/koramangala.graph.json');

describe('demand', () => {
  it('koramangala.demand.json validates against the Demand shape', () => {
    const raw = JSON.parse(readFileSync(DEMAND_PATH, 'utf8')) as Demand;
    expect(() => validateDemand(raw)).not.toThrow();
    expect(raw.seed).toBeTypeOf('number');
    expect(raw.durationSec).toBeGreaterThan(0);
    expect(raw.sources.length).toBeGreaterThan(0);
  });

  it('every spawnEdgeId in the demand is a real boundary edge', () => {
    const demand = JSON.parse(readFileSync(DEMAND_PATH, 'utf8')) as Demand;
    const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as {
      boundaryEdges: number[];
      edges: { id: number }[];
    };
    const boundarySet = new Set(graph.boundaryEdges);
    const edgeSet = new Set(graph.edges.map((e) => e.id));
    for (const src of demand.sources) {
      expect(boundarySet.has(src.spawnEdgeId)).toBe(true);
      for (const dest of src.destinations) {
        expect(boundarySet.has(dest.exitEdgeId)).toBe(true);
        expect(edgeSet.has(dest.exitEdgeId)).toBe(true);
      }
    }
  });

  it('validateDemand rejects empty sources', () => {
    expect(() =>
      validateDemand({ seed: 1, durationSec: 60, sources: [] }),
    ).toThrow(/at least one source/i);
  });

  it('validateDemand rejects zero-weight destination', () => {
    expect(() =>
      validateDemand({
        seed: 1,
        durationSec: 60,
        sources: [
          {
            id: 'x',
            spawnEdgeId: 1,
            vehiclesPerHour: 100,
            destinations: [{ exitEdgeId: 2, weight: 0 }],
          },
        ],
      }),
    ).toThrow(/weight/i);
  });
});
