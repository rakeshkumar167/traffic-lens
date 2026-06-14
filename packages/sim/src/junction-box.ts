import type { Edge, EdgeId, JunctionId, RoadGraph, SignalledJunction } from '@traffic-lens/shared';
import { LANE_HALF_WIDTH_M } from '@traffic-lens/shared';

// An axis-aligned rectangle (Web Mercator) covering a signalled intersection.
// Vehicles must not enter it on a red. One box can span several junction nodes
// that belong to the same physical intersection (real OSM data splits a single
// crossing into multiple nodes a few metres apart).
export interface JunctionBox {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number; // half-extent along x
  readonly hy: number; // half-extent along y
}

export interface JunctionBoxes {
  // One entry per physical intersection — what the renderer draws.
  readonly boxes: JunctionBox[];
  // Every signalled junction node mapped to its (possibly shared) box.
  readonly byJunction: Map<JunctionId, JunctionBox>;
}

const CLUSTER_RADIUS_M = 30; // merge junction nodes of one intersection
const BOX_MARGIN_M = 2;      // padding beyond the road edges

// Greedily group signalled junctions whose nodes sit within CLUSTER_RADIUS_M.
function cluster(junctions: SignalledJunction[]): SignalledJunction[][] {
  const used = new Set<JunctionId>();
  const groups: SignalledJunction[][] = [];
  for (const a of junctions) {
    if (used.has(a.id)) continue;
    const group = [a];
    used.add(a.id);
    for (const b of junctions) {
      if (used.has(b.id)) continue;
      if (Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) <= CLUSTER_RADIUS_M) {
        group.push(b);
        used.add(b.id);
      }
    }
    groups.push(group);
  }
  return groups;
}

export function buildJunctionBoxes(graph: RoadGraph): JunctionBoxes {
  const edgesById = new Map<EdgeId, Edge>(graph.edges.map((e) => [e.id, e]));
  const signalled = graph.junctions.filter((j): j is SignalledJunction => j.kind === 'signalled');

  const boxes: JunctionBox[] = [];
  const byJunction = new Map<JunctionId, JunctionBox>();

  for (const group of cluster(signalled)) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let roadHalf = 0;
    for (const j of group) {
      minX = Math.min(minX, j.position.x);
      maxX = Math.max(maxX, j.position.x);
      minY = Math.min(minY, j.position.y);
      maxY = Math.max(maxY, j.position.y);
      for (const eid of [...j.incomingEdges, ...j.outgoingEdges]) {
        const e = edgesById.get(eid);
        if (e) roadHalf = Math.max(roadHalf, e.lanes * LANE_HALF_WIDTH_M);
      }
    }
    const pad = roadHalf + BOX_MARGIN_M;
    const box: JunctionBox = {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      hx: (maxX - minX) / 2 + pad,
      hy: (maxY - minY) / 2 + pad,
    };
    boxes.push(box);
    for (const j of group) byJunction.set(j.id, box);
  }

  return { boxes, byJunction };
}

// Distance from an interior point, travelling along unit direction (bx, by),
// to where it exits the box. The point is assumed inside the box, so the result
// is the nearest boundary crossing in that direction (>= 0).
export function exitDistance(box: JunctionBox, px: number, py: number, bx: number, by: number): number {
  let t = Infinity;
  if (bx > 1e-9) t = Math.min(t, (box.cx + box.hx - px) / bx);
  else if (bx < -1e-9) t = Math.min(t, (box.cx - box.hx - px) / bx);
  if (by > 1e-9) t = Math.min(t, (box.cy + box.hy - py) / by);
  else if (by < -1e-9) t = Math.min(t, (box.cy - box.hy - py) / by);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}
