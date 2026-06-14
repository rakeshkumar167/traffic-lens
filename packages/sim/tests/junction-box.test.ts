import { describe, it, expect } from 'vitest';
import type { RoadGraph } from '@traffic-lens/shared';
import { buildJunctionBoxes, exitDistance } from '../src/junction-box.ts';

describe('exitDistance', () => {
  const box = { cx: 0, cy: 0, hx: 5, hy: 5 };

  it('measures to the boundary along an axis-aligned ray from the centre', () => {
    expect(exitDistance(box, 0, 0, 1, 0)).toBeCloseTo(5, 6);  // east
    expect(exitDistance(box, 0, 0, -1, 0)).toBeCloseTo(5, 6); // west
    expect(exitDistance(box, 0, 0, 0, 1)).toBeCloseTo(5, 6);  // north
  });

  it('takes the nearest crossed face for an off-centre interior point', () => {
    // 4 m from the east face, heading east → exits at 4 m.
    expect(exitDistance(box, 1, 0, 1, 0)).toBeCloseTo(4, 6);
  });
});

describe('buildJunctionBoxes', () => {
  function graphWith(): RoadGraph {
    // Two signalled nodes 10 m apart (one physical intersection) plus a lone one
    // far away. A 2-lane edge feeds the first node.
    const edges = [
      {
        id: 1, fromJunction: 10, toJunction: 100,
        geometry: [{ x: -50, y: 0 }, { x: -5, y: 0 }],
        lengthM: 45, lanes: 2, roadClass: 'secondary' as const, oneway: true,
      },
    ];
    const sig = (id: number, x: number, y: number, incoming: number[]) => ({
      id, kind: 'signalled' as const, lon: 0, lat: 0, position: { x, y },
      incomingEdges: incoming, outgoingEdges: [], connections: [],
      defaultSignalPlan: { cycleSec: 1, phases: [] },
    });
    return {
      meta: {} as RoadGraph['meta'],
      edges,
      junctions: [
        sig(100, 0, 0, [1]),
        sig(101, 10, 0, []),  // within 30 m of 100 → same box
        sig(200, 500, 0, []), // far away → its own box
      ],
      boundaryEdges: [],
    };
  }

  it('clusters nearby signals into one box and keeps distant ones separate', () => {
    const { boxes, byJunction } = buildJunctionBoxes(graphWith());
    expect(boxes.length).toBe(2);
    // The two near nodes share the same box object.
    expect(byJunction.get(100)).toBe(byJunction.get(101));
    expect(byJunction.get(200)).not.toBe(byJunction.get(100));
  });

  it('sizes the box to span the clustered nodes plus the road width', () => {
    const { byJunction } = buildJunctionBoxes(graphWith());
    const box = byJunction.get(100)!;
    // Nodes at x=0 and x=10 → centre x=5, node half-spread 5; road half-width
    // 2*1.6=3.2, +2 margin → hx = 5 + 3.2 + 2 = 10.2.
    expect(box.cx).toBeCloseTo(5, 6);
    expect(box.hx).toBeCloseTo(10.2, 6);
    // No spread in y → hy is just road half-width + margin.
    expect(box.hy).toBeCloseTo(5.2, 6);
  });
});
