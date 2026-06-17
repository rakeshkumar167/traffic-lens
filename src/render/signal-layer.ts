import { IconLayer, PolygonLayer } from '@deck.gl/layers';
import type {
  EdgeId, JunctionId, Point2D, RoadGraph, SignalPlan,
} from '@traffic-lens/shared';
import { SIGNAL_STOP_LINE_M, LANE_HALF_WIDTH_M } from '@traffic-lens/shared';
import {
  signalStateAt, buildJunctionBoxes, exitDistance, type SignalColor, type JunctionBox,
} from '@traffic-lens/sim';
import { webMercatorToLonLat } from './projection.ts';

const CLUSTER_RADIUS_M = 30;          // merge signal nodes of one intersection
const DIRECTION_TOLERANCE = Math.PI / 4; // approaches within 45° = same direction
const LEFT_MARGIN_M = 2.5;             // gap between road edge and the head
const APPROACH_LOOKBACK_M = 15;        // average approach direction over this run

// --- Portrait signal head (generated SVG, no asset files) ------------------
// A black rounded box, taller than wide, that stands beside the road: stacked
// straight / left / right arrows + a red lamp. Oriented so the top (straight)
// arrow points along the approach's travel direction.
const W = 36;
const H = 120;
const WIDTH_SCALE = 1.5;     // head is 50% wider than the base portrait box
const SW = W * WIDTH_SCALE;   // scaled source width
const ARROW_OFF = '#2b2f37';
const RED_OFF = '#3a1010';

function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function head(arrowColor: string, redColor: string): string {
  const cx = W / 2;            // arrow centre in the pre-scale coordinate space
  const pl = (pts: string): string =>
    `<polyline points='${pts}' fill='none' stroke='${arrowColor}' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/>`;
  const up = (cy: number): string => pl(`${cx},${cy + 8} ${cx},${cy - 8}`) + pl(`${cx - 6},${cy - 2} ${cx},${cy - 8} ${cx + 6},${cy - 2}`);
  const down = (cy: number): string => pl(`${cx},${cy - 8} ${cx},${cy + 8}`) + pl(`${cx - 6},${cy + 2} ${cx},${cy + 8} ${cx + 6},${cy + 2}`);
  const right = (cy: number): string => pl(`${cx - 8},${cy} ${cx + 8},${cy}`) + pl(`${cx + 2},${cy - 6} ${cx + 8},${cy} ${cx + 2},${cy + 6}`);
  // The box + arrows are drawn in the base W-wide space and stretched 50%
  // horizontally; the lamp is drawn after, at the widened centre, so it stays a
  // true circle rather than an ellipse.
  return svgUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${SW}' height='${H}' viewBox='0 0 ${SW} ${H}'>`
    + `<g transform='scale(${WIDTH_SCALE} 1)'>`
    + `<rect x='1' y='1' width='${W - 2}' height='${H - 2}' rx='9' fill='#0d0d14' stroke='#000' stroke-width='2'/>`
    // Source glyphs are stacked top→bottom; after the head's 90° rotation they
    // read left→forward→right of travel: image-up shows as left-of-travel,
    // image-right as forward, image-down as right-of-travel.
    + up(26) + right(54) + down(82)
    + `</g>`
    + `<circle cx='${SW / 2}' cy='104' r='8' fill='${redColor}'/>`
    + `</svg>`,
  );
}
function iconDef(arrowColor: string, redColor: string) {
  return { url: head(arrowColor, redColor), width: SW, height: H, anchorX: SW / 2, anchorY: H / 2, mask: false };
}
const ICON_BY_STATE: Record<SignalColor, ReturnType<typeof iconDef>> = {
  green: iconDef('#00C853', RED_OFF),
  amber: iconDef('#FFB300', RED_OFF),
  red: iconDef(ARROW_OFF, '#FF3B30'),
};

const AMBER_SEC = 3;

export interface SignalMarker {
  readonly junctionId: JunctionId;
  readonly edgeId: EdgeId;
  readonly position: [number, number]; // [lon, lat]
  readonly heading: number;            // approach bearing (radians, CCW from east)
}

// A single white stripe of a zebra crossing, as a [lon, lat] polygon ring.
export interface CrossingStripe {
  readonly polygon: [number, number][];
}

// A junction box as a [lon, lat] polygon ring (the no-entry intersection area).
export interface JunctionArea {
  readonly polygon: [number, number][];
}

export interface SignalRenderData {
  readonly markers: SignalMarker[];
  readonly crossings: CrossingStripe[];
  readonly areas: JunctionArea[];
  readonly plans: Map<JunctionId, SignalPlan>;
}

// Zebra crossing geometry (metres). Stripes run along the travel direction and
// repeat across the carriageway, centred on the sim's stop line so cars halt
// just behind it.
const CROSSING_DEPTH_M = 4;   // extent along travel direction
const STRIPE_WIDTH_M = 0.5;   // each white bar, across the road
const STRIPE_GAP_M = 0.6;     // gap between bars

type SignalledJunction = RoadGraph['junctions'][number] & { kind: 'signalled' };

function angDist(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

// Greedily cluster signalled junctions within CLUSTER_RADIUS_M (Web Mercator m).
function clusterJunctions(junctions: SignalledJunction[]): SignalledJunction[][] {
  const used = new Set<JunctionId>();
  const clusters: SignalledJunction[][] = [];
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
    clusters.push(group);
  }
  return clusters;
}

interface Approach {
  junctionId: JunctionId;
  edgeId: EdgeId;
  geometry: readonly Point2D[];
  lanes: number;
  bearing: number;
  len: number;
}

// Unit direction of travel into the junction, averaged over the last
// APPROACH_LOOKBACK_M of the polyline (more stable than the final segment), plus
// the junction-end point.
function approachVector(geometry: readonly Point2D[]): { ux: number; uy: number; end: Point2D } | null {
  const end = geometry[geometry.length - 1]!;
  let i = geometry.length - 2;
  let from = geometry[i] ?? geometry[0]!;
  let accum = 0;
  while (i > 0 && accum < APPROACH_LOOKBACK_M) {
    const a = geometry[i]!;
    const b = geometry[i + 1]!;
    accum += Math.hypot(b.x - a.x, b.y - a.y);
    from = a;
    i--;
  }
  const dx = end.x - from.x;
  const dy = end.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  return { ux: dx / len, uy: dy / len, end };
}

function markerFor(rep: Approach): SignalMarker | null {
  const v = approachVector(rep.geometry);
  if (!v) return null;
  const { ux, uy, end } = v;
  // Left of travel direction (CCW) — India left-hand traffic — offset clear of
  // the carriageway (wider roads push the head further out).
  const lx = -uy;
  const ly = ux;
  const offset = rep.lanes * LANE_HALF_WIDTH_M + LEFT_MARGIN_M;
  const x = end.x - ux * SIGNAL_STOP_LINE_M + lx * offset;
  const y = end.y - uy * SIGNAL_STOP_LINE_M + ly * offset;
  return {
    junctionId: rep.junctionId,
    edgeId: rep.edgeId,
    position: webMercatorToLonLat(x, y),
    heading: Math.atan2(uy, ux),
  };
}

// Zebra-crossing stripes spanning the carriageway, just outside the junction box
// so cars halt behind them.
function crossingFor(rep: Approach, box: JunctionBox | undefined): CrossingStripe[] {
  const v = approachVector(rep.geometry);
  if (!v) return [];
  const { ux, uy, end } = v;
  const lx = -uy; // lateral (left of travel)
  const ly = ux;
  // Distance from the junction node back to the box edge along this approach;
  // fall back to the fixed stop-line offset if there's no box.
  const stopBack = box ? exitDistance(box, end.x, end.y, -ux, -uy) : SIGNAL_STOP_LINE_M;
  // Centre of the crossing band, on the road centreline at the box boundary.
  const cx = end.x - ux * stopBack;
  const cy = end.y - uy * stopBack;
  const halfWidth = rep.lanes * LANE_HALF_WIDTH_M;
  const halfDepth = CROSSING_DEPTH_M / 2;
  const pitch = STRIPE_WIDTH_M + STRIPE_GAP_M;
  const stripes: CrossingStripe[] = [];
  // Walk across the road in both directions from the centreline.
  for (let o = -halfWidth + STRIPE_WIDTH_M / 2; o <= halfWidth; o += pitch) {
    const sw = STRIPE_WIDTH_M / 2;
    // Four corners: ±depth along travel, ±width across.
    const corner = (du: number, dl: number): [number, number] => webMercatorToLonLat(
      cx + ux * du + lx * (o + dl),
      cy + uy * du + ly * (o + dl),
    );
    stripes.push({
      polygon: [
        corner(-halfDepth, -sw),
        corner(halfDepth, -sw),
        corner(halfDepth, sw),
        corner(-halfDepth, sw),
      ],
    });
  }
  return stripes;
}

// One signal head per approach direction of each clustered intersection.
export function buildSignalMarkers(graph: RoadGraph): SignalRenderData {
  const edgeById = new Map<EdgeId, RoadGraph['edges'][number]>(graph.edges.map((e) => [e.id, e]));
  const signalled = graph.junctions.filter((j): j is SignalledJunction => j.kind === 'signalled');
  const plans = new Map<JunctionId, SignalPlan>(signalled.map((j) => [j.id, j.defaultSignalPlan]));

  const { boxes, byJunction } = buildJunctionBoxes(graph);
  const areas: JunctionArea[] = boxes.map((b) => ({
    polygon: [
      webMercatorToLonLat(b.cx - b.hx, b.cy - b.hy),
      webMercatorToLonLat(b.cx + b.hx, b.cy - b.hy),
      webMercatorToLonLat(b.cx + b.hx, b.cy + b.hy),
      webMercatorToLonLat(b.cx - b.hx, b.cy + b.hy),
    ],
  }));

  const markers: SignalMarker[] = [];
  const crossings: CrossingStripe[] = [];
  for (const cluster of clusterJunctions(signalled)) {
    const approaches: Approach[] = [];
    for (const j of cluster) {
      for (const eid of j.incomingEdges) {
        const e = edgeById.get(eid);
        if (!e || e.geometry.length < 2) continue;
        const v = approachVector(e.geometry);
        if (!v) continue;
        approaches.push({
          junctionId: j.id, edgeId: eid, geometry: e.geometry, lanes: e.lanes, len: e.lengthM,
          bearing: Math.atan2(v.uy, v.ux),
        });
      }
    }
    // Group approaches by direction; one head (the longest approach) per group.
    const groups: Approach[][] = [];
    for (const a of approaches) {
      const g = groups.find((grp) => angDist(grp[0]!.bearing, a.bearing) <= DIRECTION_TOLERANCE);
      if (g) g.push(a);
      else groups.push([a]);
    }
    for (const grp of groups) {
      const rep = grp.reduce((m, x) => (x.len > m.len ? x : m), grp[0]!);
      const marker = markerFor(rep);
      if (marker) markers.push(marker);
      crossings.push(...crossingFor(rep, byJunction.get(rep.junctionId)));
    }
  }
  return { markers, crossings, areas, plans };
}

// The junction box — the intersection area cars must not enter on a red. Drawn
// as a faint translucent fill so it reads as the conflict zone without hiding
// the basemap. Static, so it sits below the vehicles.
export function buildJunctionAreaLayer(data: SignalRenderData): PolygonLayer<JunctionArea> {
  return new PolygonLayer<JunctionArea>({
    id: 'junction-areas',
    data: data.areas,
    getPolygon: (a) => a.polygon,
    getFillColor: [255, 196, 0, 28],
    getLineColor: [255, 196, 0, 120],
    getLineWidth: 1,
    lineWidthUnits: 'pixels',
    stroked: true,
    filled: true,
    extruded: false,
    pickable: false,
  });
}

// White zebra-crossing stripes painted on the carriageway at each stop line.
// Static (no per-frame state), so it lives below the moving vehicles.
export function buildCrossingLayer(data: SignalRenderData): PolygonLayer<CrossingStripe> {
  return new PolygonLayer<CrossingStripe>({
    id: 'crossings',
    data: data.crossings,
    getPolygon: (s) => s.polygon,
    getFillColor: [245, 245, 245, 200],
    stroked: false,
    extruded: false,
    pickable: false,
  });
}

export function buildSignalLayers(
  data: SignalRenderData,
  simSec: number,
): IconLayer<SignalMarker>[] {
  const stateOf = (m: SignalMarker): SignalColor => {
    const plan = data.plans.get(m.junctionId);
    return plan ? signalStateAt(plan, m.edgeId, simSec, AMBER_SEC) : 'red';
  };
  return [
    new IconLayer<SignalMarker>({
      id: 'signals',
      data: data.markers,
      getIcon: (m) => ICON_BY_STATE[stateOf(m)],
      getPosition: (m) => m.position,
      // Base alignment is "up (straight arrow) = travel direction" (heading − 90).
      // We then rotate the head a further 90° anticlockwise (deck.gl getAngle is
      // CCW), swinging its bottom edge round to the right edge; the −90 and +90
      // cancel, leaving the raw heading.
      getAngle: (m) => (m.heading * 180) / Math.PI,
      sizeUnits: 'meters',
      getSize: 7,
      sizeMinPixels: 14,
      sizeMaxPixels: 40,
      billboard: true,
      updateTriggers: { getIcon: simSec },
    }),
  ];
}
