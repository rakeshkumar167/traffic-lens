import { describe, it, expect } from 'vitest';
import type {
  Edge,
  Junction,
  PriorityJunction,
  RoadGraph,
} from '@traffic-lens/shared';
import { validateRoadGraph } from '../src/validate.ts';

function makeGraph(overrides: {
  edges?: Edge[];
  junctions?: Junction[];
  boundaryEdges?: number[];
}): RoadGraph {
  return {
    meta: {
      bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
      projection: 'webMercator',
      generatedAt: '2026-06-12T00:00:00.000Z',
      sourceHash: 'abc',
      scriptVersion: '0.0.0',
    },
    edges: overrides.edges ?? [],
    junctions: overrides.junctions ?? [],
    boundaryEdges: overrides.boundaryEdges ?? [],
  };
}

function pjJ(id: number, incoming: number[], outgoing: number[]): PriorityJunction {
  return {
    id,
    kind: 'priority',
    lon: 0,
    lat: 0,
    position: { x: 0, y: 0 },
    incomingEdges: incoming,
    outgoingEdges: outgoing,
    connections: [],
    priorityEdges: incoming,
  };
}

function eg(id: number, from: number, to: number, lengthM = 100): Edge {
  return {
    id,
    fromJunction: from,
    toJunction: to,
    geometry: [{ x: 0, y: 0 }, { x: lengthM, y: 0 }],
    lengthM,
    lanes: 1,
    roadClass: 'residential',
    oneway: true,
  };
}

describe('validateRoadGraph', () => {
  it('accepts a minimal valid graph', () => {
    const g = makeGraph({
      edges: [eg(0, 1, 2), eg(1, 2, 3)],
      junctions: [pjJ(1, [], [0]), pjJ(2, [0], [1]), pjJ(3, [1], [])],
      boundaryEdges: [0, 1],
    });
    expect(() => validateRoadGraph(g)).not.toThrow();
  });

  it('rejects an edge with zero length', () => {
    const zero = eg(0, 1, 2, 0);
    const g = makeGraph({
      edges: [zero],
      junctions: [pjJ(1, [], [0]), pjJ(2, [0], [])],
      boundaryEdges: [0],
    });
    expect(() => validateRoadGraph(g)).toThrow(/zero length/i);
  });

  it('rejects an edge referencing a missing junction', () => {
    const g = makeGraph({
      edges: [eg(0, 1, 99)],
      junctions: [pjJ(1, [], [0])],
      boundaryEdges: [0],
    });
    expect(() => validateRoadGraph(g)).toThrow(/junction 99/i);
  });

  it('rejects a graph that is not weakly connected', () => {
    const g = makeGraph({
      edges: [eg(0, 1, 2), eg(1, 3, 4)],
      junctions: [
        pjJ(1, [], [0]),
        pjJ(2, [0], []),
        pjJ(3, [], [1]),
        pjJ(4, [1], []),
      ],
      boundaryEdges: [0, 1],
    });
    expect(() => validateRoadGraph(g)).toThrow(/not weakly connected/i);
  });

  it('rejects a boundaryEdges entry referencing a missing edge', () => {
    const g = makeGraph({
      edges: [eg(0, 1, 2)],
      junctions: [pjJ(1, [], [0]), pjJ(2, [0], [])],
      boundaryEdges: [0, 99], // edge 99 does not exist
    });
    expect(() => validateRoadGraph(g)).toThrow(/boundaryEdges.*missing edge 99/i);
  });
});
