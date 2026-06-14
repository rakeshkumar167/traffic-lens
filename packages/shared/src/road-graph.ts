// Road network graph as emitted by the preprocessor and consumed by the sim
// and renderer. Geometry is in Web Mercator world coordinates (EPSG:3857).

export type EdgeId = number;
export type JunctionId = number;
export type LaneIndex = number;

export type RoadClass =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'unclassified'
  | 'service'
  | 'primary_link'
  | 'secondary_link'
  | 'tertiary_link';

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface Edge {
  readonly id: EdgeId;
  readonly fromJunction: JunctionId;
  readonly toJunction: JunctionId;
  // Polyline geometry in Web Mercator world coordinates.
  // First point is at fromJunction, last point is at toJunction.
  readonly geometry: readonly Point2D[];
  // Total length in metres along the polyline.
  readonly lengthM: number;
  readonly lanes: number;
  readonly roadClass: RoadClass;
  // True if this edge is one direction of an OSM way tagged oneway=yes.
  // (Bidirectional ways produce two Edges with `oneway: false`.)
  readonly oneway: boolean;
}

export interface JunctionConnection {
  readonly fromEdge: EdgeId;
  readonly fromLane: LaneIndex;
  readonly toEdge: EdgeId;
  readonly toLane: LaneIndex;
}

export interface SignalPhase {
  readonly greenIncomingEdges: readonly EdgeId[];
  readonly durationSec: number;
}

export interface SignalPlan {
  readonly cycleSec: number;
  readonly phases: readonly SignalPhase[];
}

export interface SignalledJunction {
  readonly id: JunctionId;
  readonly kind: 'signalled';
  readonly lon: number;
  readonly lat: number;
  readonly position: Point2D;
  readonly incomingEdges: readonly EdgeId[];
  readonly outgoingEdges: readonly EdgeId[];
  readonly connections: readonly JunctionConnection[];
  readonly defaultSignalPlan: SignalPlan;
}

export interface PriorityJunction {
  readonly id: JunctionId;
  readonly kind: 'priority';
  readonly lon: number;
  readonly lat: number;
  readonly position: Point2D;
  readonly incomingEdges: readonly EdgeId[];
  readonly outgoingEdges: readonly EdgeId[];
  readonly connections: readonly JunctionConnection[];
  // EdgeIds that have priority (do not yield) at this junction.
  // Determined by road-class rank.
  readonly priorityEdges: readonly EdgeId[];
}

export type Junction = SignalledJunction | PriorityJunction;

export interface BoundingBox {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

export interface RoadGraphMeta {
  readonly bbox: BoundingBox;
  readonly projection: 'webMercator';
  readonly generatedAt: string; // ISO 8601 UTC
  readonly sourceHash: string;  // SHA-256 hex of the input OSM file
  readonly scriptVersion: string; // semver of @traffic-lens/osm-preprocess
}

export interface RoadGraph {
  readonly meta: RoadGraphMeta;
  readonly edges: readonly Edge[];
  readonly junctions: readonly Junction[];
  readonly boundaryEdges: readonly EdgeId[];
}

// Speed estimates per road class (m/s). Used by the routing cost function
// in the sim and by the spawn initial-speed logic.
export const ROAD_CLASS_SPEED_MPS: Readonly<Record<RoadClass, number>> = {
  primary: 13.9,         // ~50 km/h
  primary_link: 11.1,    // ~40 km/h
  secondary: 11.1,       // ~40 km/h
  secondary_link: 8.3,
  tertiary: 8.3,         // ~30 km/h
  tertiary_link: 5.6,
  residential: 5.6,      // ~20 km/h
  unclassified: 5.6,
  service: 4.2,          // ~15 km/h
};

// Default lane counts per road class when the OSM `lanes=` tag is absent.
// These are direction-specific (total lanes for bidirectional ways are doubled).
export const ROAD_CLASS_DEFAULT_LANES: Readonly<Record<RoadClass, number>> = {
  primary: 3,
  primary_link: 1,
  secondary: 2,
  secondary_link: 1,
  tertiary: 2,
  tertiary_link: 1,
  residential: 1,
  unclassified: 1,
  service: 1,
};

// Distance (metres) before a junction at which vehicles stop for a red signal,
// and where the signal head is drawn. Keeps the sim's stop point and the on-map
// mark aligned so vehicles halt at the red, not past it. Set back ~one signal
// length from the junction so the head sits clearly on the approach.
export const SIGNAL_STOP_LINE_M = 12;

// Priority ranking for priority-yield junctions. Higher value = higher priority.
export const ROAD_CLASS_PRIORITY_RANK: Readonly<Record<RoadClass, number>> = {
  primary: 6,
  primary_link: 5,
  secondary: 4,
  secondary_link: 3,
  tertiary: 2,
  tertiary_link: 2,
  residential: 1,
  unclassified: 1,
  service: 0,
};
