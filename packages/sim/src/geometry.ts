import type { Edge, EdgeId } from '@traffic-lens/shared';

// Per-edge cumulative arc length, precomputed once so the hot path can place a
// vehicle along the *polyline* (not a straight start→end chord). 33% of real OSM
// edges have intermediate vertices and some are near-loops where the chord
// collapses to a point; lerping endpoint→endpoint compresses the progress→
// position mapping and makes evenly-spaced cars visually stack.

export interface EdgePolyline {
  readonly cum: Float64Array; // cum[k] = arc length from start to vertex k
  readonly total: number;     // full polyline length
}

export function buildEdgePolylines(edges: Iterable<Edge>): Map<EdgeId, EdgePolyline> {
  const out = new Map<EdgeId, EdgePolyline>();
  for (const e of edges) {
    const g = e.geometry;
    const cum = new Float64Array(g.length);
    for (let k = 1; k < g.length; k++) {
      cum[k] = cum[k - 1]! + Math.hypot(g[k]!.x - g[k - 1]!.x, g[k]!.y - g[k - 1]!.y);
    }
    out.set(e.id, { cum, total: cum[g.length - 1]! });
  }
  return out;
}

export interface PointHeading {
  x: number;
  y: number;
  heading: number; // radians CCW from +x
}

// Position + heading at a fractional progress (0..1) along the edge polyline.
// Writes into `out` to avoid per-call allocation on the hot path.
export function interpolateAlong(
  edge: Edge,
  poly: EdgePolyline,
  progress: number,
  out: PointHeading,
): void {
  const g = edge.geometry;
  const cum = poly.cum;
  const t = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  const target = t * poly.total;
  // Find the segment [k-1, k] containing `target`. Linear scan: edges average a
  // handful of vertices, so a binary search's constants don't pay off yet.
  let k = 1;
  while (k < cum.length - 1 && cum[k]! < target) k++;
  const a = g[k - 1]!;
  const b = g[k]!;
  const segLen = cum[k]! - cum[k - 1]!;
  const f = segLen > 1e-9 ? (target - cum[k - 1]!) / segLen : 0;
  out.x = a.x + (b.x - a.x) * f;
  out.y = a.y + (b.y - a.y) * f;
  out.heading = Math.atan2(b.y - a.y, b.x - a.x);
}
