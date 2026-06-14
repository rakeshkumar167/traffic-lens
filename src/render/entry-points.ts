import { ScatterplotLayer } from '@deck.gl/layers';
import type { EdgeId, RoadGraph } from '@traffic-lens/shared';
import { webMercatorToLonLat } from './projection.ts';

export interface EntryMarker {
  readonly edgeId: EdgeId;
  readonly position: [number, number]; // [lon, lat]
}

// One marker per candidate entry edge, placed at its spawn point (the outside
// end of the edge — geometry[0] — which is where vehicles appear).
export function buildEntryMarkers(graph: RoadGraph, entryEdgeIds: readonly EdgeId[]): EntryMarker[] {
  const edgeById = new Map<EdgeId, RoadGraph['edges'][number]>(
    graph.edges.map((e) => [e.id, e]),
  );
  const markers: EntryMarker[] = [];
  for (const id of entryEdgeIds) {
    const edge = edgeById.get(id);
    if (!edge || edge.geometry.length === 0) continue;
    const p = edge.geometry[0]!;
    markers.push({ edgeId: id, position: webMercatorToLonLat(p.x, p.y) });
  }
  return markers;
}

// Candidate spawn points use a vivid, opaque colour (faded yellow read poorly);
// selected ones flip to green. White rings keep both legible on the basemap.
const SELECTED_FILL: [number, number, number, number] = [40, 200, 90, 245];
const SELECTED_LINE: [number, number, number, number] = [255, 255, 255, 245];
const AVAILABLE_FILL: [number, number, number, number] = [255, 45, 120, 225]; // vivid pink/magenta
const AVAILABLE_LINE: [number, number, number, number] = [255, 255, 255, 235];

export function buildEntryLayer(
  markers: EntryMarker[],
  selectedIds: readonly EdgeId[],
): ScatterplotLayer<EntryMarker> {
  const selected = new Set(selectedIds);
  const key = selectedIds.join(',');
  return new ScatterplotLayer<EntryMarker>({
    id: 'entry-points',
    data: markers,
    pickable: true,
    radiusUnits: 'pixels',
    getPosition: (d) => d.position,
    getRadius: (d) => (selected.has(d.edgeId) ? 10 : 8),
    stroked: true,
    lineWidthMinPixels: 2,
    getLineColor: (d) => (selected.has(d.edgeId) ? SELECTED_LINE : AVAILABLE_LINE),
    getFillColor: (d) => (selected.has(d.edgeId) ? SELECTED_FILL : AVAILABLE_FILL),
    updateTriggers: { getRadius: key, getLineColor: key, getFillColor: key },
  });
}
