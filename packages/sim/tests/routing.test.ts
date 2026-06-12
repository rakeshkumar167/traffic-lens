import { describe, it, expect } from 'vitest';
import type { Edge, Junction, RoadGraph } from '@traffic-lens/shared';
import { Router } from '../src/routing.ts';

function edge(id: number, from: number, to: number, lengthM: number, geom: [number,number][]): Edge {
  return {
    id, fromJunction: from, toJunction: to,
    geometry: geom.map(([x,y]) => ({ x, y })),
    lengthM, lanes: 1, roadClass: 'residential', oneway: true,
  };
}

function pj(id: number, x: number, y: number): Junction {
  return {
    id, kind: 'priority', lon: 0, lat: 0, position: { x, y },
    incomingEdges: [], outgoingEdges: [], connections: [], priorityEdges: [],
  };
}

const META = {
  bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
  projection: 'webMercator' as const,
  generatedAt: '', sourceHash: '', scriptVersion: '',
};

describe('Router', () => {
  // Linear graph: 1 → 2 → 3 → 4 over edges 10, 20, 30.
  const linear: RoadGraph = {
    meta: META,
    edges: [
      edge(10, 1, 2, 100, [[0,0],[100,0]]),
      edge(20, 2, 3, 100, [[100,0],[200,0]]),
      edge(30, 3, 4, 100, [[200,0],[300,0]]),
    ],
    junctions: [pj(1,0,0), pj(2,100,0), pj(3,200,0), pj(4,300,0)],
    boundaryEdges: [10, 30],
  };

  it('finds a single-edge route when spawn equals exit', () => {
    const r = new Router(linear);
    expect(r.findRoute(10, 10)).toEqual([10]);
  });

  it('finds the direct linear route', () => {
    const r = new Router(linear);
    expect(r.findRoute(10, 30)).toEqual([10, 20, 30]);
  });

  it('returns null when no path exists', () => {
    const disconnected: RoadGraph = {
      ...linear,
      edges: [
        edge(10, 1, 2, 100, [[0,0],[100,0]]),
        edge(99, 3, 4, 100, [[500,0],[600,0]]),
      ],
      junctions: [pj(1,0,0), pj(2,100,0), pj(3,500,0), pj(4,600,0)],
    };
    const r = new Router(disconnected);
    expect(r.findRoute(10, 99)).toBeNull();
  });

  it('prefers the shorter of two paths', () => {
    // Diamond: 1 → 2 (short, edge 10), 1 → 3 (long, edge 11), both converge at 4.
    const diamond: RoadGraph = {
      meta: META,
      edges: [
        edge(10, 1, 2,  50, [[0,0],[50,0]]),
        edge(11, 1, 3, 500, [[0,0],[0,500]]),
        edge(20, 2, 4, 100, [[50,0],[150,0]]),
        edge(21, 3, 4, 100, [[0,500],[150,500]]),
        edge(30, 4, 5, 50,  [[150,0],[200,0]]),
      ],
      junctions: [pj(1,0,0), pj(2,50,0), pj(3,0,500), pj(4,150,0), pj(5,200,0)],
      boundaryEdges: [10, 30],
    };
    const r = new Router(diamond);
    expect(r.findRoute(10, 30)).toEqual([10, 20, 30]);
  });

  it('caches results: a second findRoute returns the same array instance', () => {
    const r = new Router(linear);
    const a = r.findRoute(10, 30);
    const b = r.findRoute(10, 30);
    expect(b).toBe(a);
  });
});
