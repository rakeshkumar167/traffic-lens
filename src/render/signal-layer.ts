import { PolygonLayer } from '@deck.gl/layers';
import type {
  EdgeId, JunctionId, Point2D, RoadGraph, SignalPlan,
} from '@traffic-lens/shared';
import { greenIncomingEdgesAt } from '@traffic-lens/sim';
import { webMercatorToLonLat } from './projection.ts';

// Stop-bar placement/size in Web Mercator metres.
const STOP_LINE_OFFSET_M = 6; // bar centre, back from the junction node
const BAR_ACROSS_M = 7;       // width across the approach road
const BAR_DEPTH_M = 3;        // thickness along the approach road

export interface SignalMarker {
  readonly junctionId: JunctionId;
  readonly edgeId: EdgeId;
  readonly polygon: number[][]; // ring of [lon, lat] corners
}

export interface SignalRenderData {
  readonly markers: SignalMarker[];
  readonly plans: Map<JunctionId, SignalPlan>;
}

// Oriented stop-bar rectangle at the junction end of an edge: a bar across the
// road, set back a few metres from the node. Returns null for degenerate geometry.
function stopBarPolygon(geometry: readonly Point2D[]): number[][] | null {
  if (geometry.length < 2) return null;
  const end = geometry[geometry.length - 1]!;
  const prev = geometry[geometry.length - 2]!;
  const dx = end.x - prev.x;
  const dy = end.y - prev.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  // Unit vector along the approach (toward the junction) and its perpendicular.
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const cx = end.x - ux * STOP_LINE_OFFSET_M;
  const cy = end.y - uy * STOP_LINE_OFFSET_M;
  const aw = BAR_ACROSS_M / 2;
  const ad = BAR_DEPTH_M / 2;
  const corner = (sAcross: number, sDepth: number): number[] => webMercatorToLonLat(
    cx + px * aw * sAcross + ux * ad * sDepth,
    cy + py * aw * sAcross + uy * ad * sDepth,
  );
  return [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)];
}

// Precompute (once per run) a stop-bar per incoming approach of each signalled
// junction, plus the plan lookup used to colour them each frame.
export function buildSignalMarkers(graph: RoadGraph): SignalRenderData {
  const edgeById = new Map<EdgeId, RoadGraph['edges'][number]>(
    graph.edges.map((e) => [e.id, e]),
  );
  const markers: SignalMarker[] = [];
  const plans = new Map<JunctionId, SignalPlan>();

  for (const j of graph.junctions) {
    if (j.kind !== 'signalled') continue;
    plans.set(j.id, j.defaultSignalPlan);
    for (const edgeId of j.incomingEdges) {
      const edge = edgeById.get(edgeId);
      if (!edge) continue; // dropped by clipping
      const polygon = stopBarPolygon(edge.geometry);
      if (!polygon) continue;
      markers.push({ junctionId: j.id, edgeId, polygon });
    }
  }
  return { markers, plans };
}

const GREEN: [number, number, number, number] = [31, 191, 90, 235];
const RED: [number, number, number, number] = [220, 45, 40, 235];

export function buildSignalLayer(
  data: SignalRenderData,
  simSec: number,
): PolygonLayer<SignalMarker> {
  // Green edge set per junction, computed once per frame.
  const greenByJunction = new Map<JunctionId, Set<EdgeId>>();
  for (const [jid, plan] of data.plans) {
    greenByJunction.set(jid, new Set(greenIncomingEdgesAt(plan, simSec)));
  }
  return new PolygonLayer<SignalMarker>({
    id: 'signals',
    data: data.markers,
    getPolygon: (d) => d.polygon,
    stroked: true,
    filled: true,
    lineWidthMinPixels: 1,
    getLineColor: [10, 10, 20, 230],
    getFillColor: (d) => (greenByJunction.get(d.junctionId)?.has(d.edgeId) ? GREEN : RED),
    updateTriggers: { getFillColor: simSec },
  });
}
