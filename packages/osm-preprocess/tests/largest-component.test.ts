import { describe, it, expect } from 'vitest';
import type { Edge, Junction, PriorityJunction } from '@traffic-lens/shared';
import { pruneToLargestComponent } from '../src/largest-component.ts';

function pj(id: number, incoming: number[], outgoing: number[]): PriorityJunction {
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

function eg(id: number, from: number, to: number): Edge {
  return {
    id,
    fromJunction: from,
    toJunction: to,
    geometry: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    lengthM: 100,
    lanes: 1,
    roadClass: 'residential',
    oneway: true,
  };
}

describe('pruneToLargestComponent', () => {
  it('keeps a connected graph unchanged', () => {
    const edges = [eg(0, 1, 2), eg(1, 2, 3)];
    const junctions: Junction[] = [pj(1, [], [0]), pj(2, [0], [1]), pj(3, [1], [])];
    const result = pruneToLargestComponent(edges, junctions);
    expect(result.edges.length).toBe(2);
    expect(result.junctions.length).toBe(3);
    expect(result.droppedEdgeCount).toBe(0);
    expect(result.droppedJunctionCount).toBe(0);
  });

  it('drops a smaller disconnected component', () => {
    // Component A: 1 → 2 → 3 (3 junctions, 2 edges)
    // Component B: 4 → 5     (2 junctions, 1 edge)
    const edges = [eg(0, 1, 2), eg(1, 2, 3), eg(2, 4, 5)];
    const junctions: Junction[] = [
      pj(1, [], [0]),
      pj(2, [0], [1]),
      pj(3, [1], []),
      pj(4, [], [2]),
      pj(5, [2], []),
    ];
    const result = pruneToLargestComponent(edges, junctions);
    expect(result.junctions.map((j) => j.id).sort()).toEqual([1, 2, 3]);
    expect(result.edges.map((e) => e.id).sort()).toEqual([0, 1]);
    expect(result.droppedJunctionCount).toBe(2);
    expect(result.droppedEdgeCount).toBe(1);
  });

  it('returns input unchanged when empty', () => {
    const result = pruneToLargestComponent([], []);
    expect(result.edges).toEqual([]);
    expect(result.junctions).toEqual([]);
    expect(result.droppedJunctionCount).toBe(0);
    expect(result.droppedEdgeCount).toBe(0);
  });

  it('handles three components by keeping the largest', () => {
    // A: 4 junctions, B: 2, C: 3 → A wins.
    const edges = [
      eg(0, 1, 2), eg(1, 2, 3), eg(2, 3, 4),
      eg(3, 5, 6),
      eg(4, 7, 8), eg(5, 8, 9),
    ];
    const junctions: Junction[] = [
      pj(1, [], [0]),
      pj(2, [0], [1]),
      pj(3, [1], [2]),
      pj(4, [2], []),
      pj(5, [], [3]),
      pj(6, [3], []),
      pj(7, [], [4]),
      pj(8, [4], [5]),
      pj(9, [5], []),
    ];
    const result = pruneToLargestComponent(edges, junctions);
    expect(result.junctions.length).toBe(4);
    expect(result.junctions.map((j) => j.id).sort()).toEqual([1, 2, 3, 4]);
  });
});
