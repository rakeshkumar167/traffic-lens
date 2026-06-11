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
  it('marks every edge incident to a dead-end junction (1, 4, 5, 6)', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    const boundaryEdgeIds = new Set(findBoundaryEdges(edges, junctions));

    // Nodes 1, 4, 5, 6 are all dead-ends in the fixture: each is touched by
    // exactly one road (and therefore has exactly one neighbor junction).
    // Nodes 2 and 3 are interior junctions.
    const boundaryNodes = new Set([1, 4, 5, 6]);
    for (const e of edges) {
      const isBoundary =
        boundaryNodes.has(e.fromJunction) || boundaryNodes.has(e.toJunction);
      expect(boundaryEdgeIds.has(e.id)).toBe(isBoundary);
    }
  });

  it('includes both directions of a bidirectional dead-end', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    const boundaryEdgeIds = new Set(findBoundaryEdges(edges, junctions));
    // Regression guard: way 100 is bidirectional ending at node 1. Both
    // directions of the edges incident to node 1 must be boundary edges,
    // even though node 1 has degree 2 (one incoming + one outgoing).
    const node1Edges = edges.filter(
      (e) => e.fromJunction === 1 || e.toJunction === 1,
    );
    expect(node1Edges.length).toBe(2);
    expect(node1Edges.every((e) => boundaryEdgeIds.has(e.id))).toBe(true);
  });

  it('returns no duplicates', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    const result = findBoundaryEdges(edges, junctions);
    expect(new Set(result).size).toBe(result.length);
  });
});
