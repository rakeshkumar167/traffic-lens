import { describe, it, expect } from 'vitest';
import type { Edge } from '@traffic-lens/shared';
import { buildEdgePolylines, interpolateAlong, type PointHeading } from '../src/geometry.ts';

function edge(id: number, geometry: { x: number; y: number }[]): Edge {
  let len = 0;
  for (let k = 1; k < geometry.length; k++) {
    len += Math.hypot(geometry[k]!.x - geometry[k - 1]!.x, geometry[k]!.y - geometry[k - 1]!.y);
  }
  return {
    id, fromJunction: 1, toJunction: 2,
    geometry, lengthM: len, lanes: 1, roadClass: 'residential', oneway: true,
  };
}

describe('interpolateAlong', () => {
  it('places progress at the correct arc-length point on an L-shaped polyline', () => {
    // Two equal 10 m legs: east then north. Total 20 m.
    const e = edge(1, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    const poly = buildEdgePolylines([e]).get(1)!;
    expect(poly.total).toBeCloseTo(20, 6);

    const out: PointHeading = { x: 0, y: 0, heading: 0 };

    // Midpoint by arc length is the corner — a straight chord lerp would instead
    // land at (5, 5), nowhere on the road.
    interpolateAlong(e, poly, 0.5, out);
    expect(out.x).toBeCloseTo(10, 6);
    expect(out.y).toBeCloseTo(0, 6);

    // Quarter of the way: 5 m east along the first leg.
    interpolateAlong(e, poly, 0.25, out);
    expect(out.x).toBeCloseTo(5, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.heading).toBeCloseTo(0, 6); // heading east

    // Three quarters: 5 m up the second leg, heading north.
    interpolateAlong(e, poly, 0.75, out);
    expect(out.x).toBeCloseTo(10, 6);
    expect(out.y).toBeCloseTo(5, 6);
    expect(out.heading).toBeCloseTo(Math.PI / 2, 6);
  });

  it('keeps evenly spaced progress evenly spaced in arc length (no bunching)', () => {
    const e = edge(1, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    const poly = buildEdgePolylines([e]).get(1)!;
    const out: PointHeading = { x: 0, y: 0, heading: 0 };
    const pts: { x: number; y: number }[] = [];
    for (let p = 0; p <= 1.0001; p += 0.1) {
      interpolateAlong(e, poly, p, out);
      pts.push({ x: out.x, y: out.y });
    }
    for (let k = 1; k < pts.length; k++) {
      const d = Math.hypot(pts[k]!.x - pts[k - 1]!.x, pts[k]!.y - pts[k - 1]!.y);
      expect(d).toBeCloseTo(2, 4); // 0.1 * 20 m total = 2 m each step
    }
  });

  it('handles a degenerate loop edge (chord ≈ 0) without collapsing', () => {
    // Start and end coincide; a chord lerp would map every progress to the origin.
    const e = edge(1, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 0 }]);
    const poly = buildEdgePolylines([e]).get(1)!;
    const out: PointHeading = { x: 0, y: 0, heading: 0 };
    interpolateAlong(e, poly, 0.5, out);
    expect(out.x).toBeCloseTo(5, 6); // far point of the loop, not the origin
    expect(out.y).toBeCloseTo(0, 6);
  });
});
