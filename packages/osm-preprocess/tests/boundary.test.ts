import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseOsmFile } from '../src/parse.ts';
import { buildEdges } from '../src/graph.ts';
import { buildJunctions } from '../src/junctions.ts';
import { findBoundaryEdges } from '../src/boundary.ts';

const here = dirname(fileURLToPath(import.meta.url));
const TINY_FIXTURE = join(here, 'fixtures', 'tiny.osm');

describe('findBoundaryEdges (tiny.osm fixture)', () => {
  it('marks every edge that enters or exits a degree-1 junction', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    const boundaryEdgeIds = new Set(findBoundaryEdges(edges, junctions));

    // Identify degree-1 junctions
    const degree1Nodes = new Set<number>();
    for (const j of junctions) {
      const degree = j.incomingEdges.length + j.outgoingEdges.length;
      if (degree === 1) {
        degree1Nodes.add(j.id);
      }
    }

    // Every edge incident to a degree-1 junction is a boundary edge.
    for (const e of edges) {
      const isBoundary = degree1Nodes.has(e.fromJunction) || degree1Nodes.has(e.toJunction);
      expect(boundaryEdgeIds.has(e.id)).toBe(isBoundary);
    }
  });

  it('returns no duplicates', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    const result = findBoundaryEdges(edges, junctions);
    expect(new Set(result).size).toBe(result.length);
  });
});
