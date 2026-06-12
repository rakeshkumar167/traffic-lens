// Koramangala 5th Block centroid. Numbers come from the bbox used by Plan A's
// preprocessor (data/koramangala.graph.json meta.bbox) — rough centre.
export const INITIAL_VIEW = {
  longitude: 77.6275,
  latitude: 12.938,
  zoom: 15,
  pitch: 0,
  bearing: 0,
};

// Free no-API-key style provided by MapLibre upstream. Swap to MapTiler or a
// self-hosted style by replacing this URL.
export const BASE_STYLE_URL = 'https://demotiles.maplibre.org/style.json';
