import type { StyleSpecification } from 'maplibre-gl';

// Koramangala 5th Block centroid. Numbers come from the bbox used by Plan A's
// preprocessor (data/koramangala.graph.json meta.bbox) — rough centre.
export const INITIAL_VIEW = {
  longitude: 77.6275,
  latitude: 12.938,
  zoom: 15,
  pitch: 0,
  bearing: 0,
};

// Inline raster style using OpenStreetMap's tile server. No API key required.
// OSM's tile-usage policy permits light/development use; for production swap to
// a proper basemap provider (MapTiler, Mapbox, Carto, self-hosted vector).
export const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'osm-bg', type: 'background', paint: { 'background-color': '#0f1318' } },
    { id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 },
  ],
};
