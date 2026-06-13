import { describe, it, expect } from 'vitest';
import type {
  BoundingBox, Edge, EdgeId, JunctionId, PriorityJunction, RoadGraph,
} from '@traffic-lens/shared';
import { clipGraph, buildDemand } from '../src/region.ts';

function pj(id: JunctionId, lon: number, lat: number): PriorityJunction {
  return {
    id, kind: 'priority', lon, lat, position: { x: 0, y: 0 },
    incomingEdges: [], outgoingEdges: [], connections: [], priorityEdges: [],
  };
}

function edge(id: EdgeId, from: JunctionId, to: JunctionId): Edge {
  return {
    id, fromJunction: from, toJunction: to,
    geometry: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    lengthM: 100, lanes: 1, roadClass: 'residential', oneway: true,
  };
}

// Bbox covers lon/lat [0,10]. A,B inside; C,D outside.
const BBOX: BoundingBox = { minLon: 0, minLat: 0, maxLon: 10, maxLat: 10 };
const A = pj(1, 5, 5);
const B = pj(2, 6, 6);
const C = pj(3, 15, 5);   // east, outside
const D = pj(4, 5, 15);   // north, outside

const E_ENTRY = edge(10, C.id, A.id); // outside -> inside
const E_EXIT1 = edge(11, A.id, C.id); // inside -> outside
const E_INNER = edge(12, A.id, B.id); // inside -> inside
const E_OUT = edge(13, C.id, D.id);   // outside -> outside (dropped)
const E_EXIT2 = edge(14, B.id, D.id); // inside -> outside

const GRAPH: RoadGraph = {
  meta: {
    bbox: { minLon: -1, minLat: -1, maxLon: 100, maxLat: 100 },
    projection: 'webMercator',
    generatedAt: '2026-06-13T00:00:00.000Z',
    sourceHash: 'x', scriptVersion: '0.0.0',
  },
  edges: [E_ENTRY, E_EXIT1, E_INNER, E_OUT, E_EXIT2],
  junctions: [A, B, C, D],
  boundaryEdges: [],
};

describe('clipGraph', () => {
  it('keeps edges with at least one endpoint inside, drops fully-outside edges', () => {
    const { graph } = clipGraph(GRAPH, BBOX);
    const keptIds = graph.edges.map((e) => e.id).sort((a, b) => a - b);
    expect(keptIds).toEqual([10, 11, 12, 14]); // E_OUT (13) dropped
  });

  it('classifies inward edges (outside->inside) as entries', () => {
    const { entryEdgeIds } = clipGraph(GRAPH, BBOX);
    expect([...entryEdgeIds].sort((a, b) => a - b)).toEqual([10]);
  });

  it('classifies outward edges (inside->outside) as exits', () => {
    const { exitEdgeIds } = clipGraph(GRAPH, BBOX);
    expect([...exitEdgeIds].sort((a, b) => a - b)).toEqual([11, 14]);
  });

  it('does not classify fully-interior edges as entry or exit', () => {
    const { entryEdgeIds, exitEdgeIds } = clipGraph(GRAPH, BBOX);
    expect(entryEdgeIds).not.toContain(12);
    expect(exitEdgeIds).not.toContain(12);
  });

  it('sets meta.bbox to the selection and boundaryEdges to entries union exits', () => {
    const { graph } = clipGraph(GRAPH, BBOX);
    expect(graph.meta.bbox).toEqual(BBOX);
    expect([...graph.boundaryEdges].sort((a, b) => a - b)).toEqual([10, 11, 14]);
  });

  it('keeps junctions referenced by kept edges (including outside endpoints)', () => {
    const { graph } = clipGraph(GRAPH, BBOX);
    const ids = graph.junctions.map((j) => j.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it('returns no entries/exits/edges when selection contains no junctions', () => {
    const empty: BoundingBox = { minLon: 90, minLat: 90, maxLon: 95, maxLat: 95 };
    const { graph, entryEdgeIds, exitEdgeIds } = clipGraph(GRAPH, empty);
    expect(graph.edges).toHaveLength(0);
    expect(entryEdgeIds).toHaveLength(0);
    expect(exitEdgeIds).toHaveLength(0);
  });
});

describe('buildDemand', () => {
  it('creates one source per entry with all exits as equal-weight destinations', () => {
    const demand = buildDemand([10, 20], [30, 40], 500, 42);
    expect(demand.seed).toBe(42);
    expect(demand.sources).toHaveLength(2);
    const s0 = demand.sources[0]!;
    expect(s0.spawnEdgeId).toBe(10);
    expect(s0.vehiclesPerHour).toBe(500);
    expect(s0.destinations).toEqual([
      { exitEdgeId: 30, weight: 1 },
      { exitEdgeId: 40, weight: 1 },
    ]);
  });

  it('produces no sources when there are no entries or no exits', () => {
    expect(buildDemand([], [30], 500, 42).sources).toHaveLength(0);
    expect(buildDemand([10], [], 500, 42).sources).toHaveLength(0);
  });
});
