// Inverse of the preprocessor's lonLatToWebMercator (EPSG:3857, R=6378137).
// Vehicle/junction geometry is stored in Web Mercator world metres; the map
// (MapLibre + deck.gl) wants [lon, lat] degrees.
const EARTH_RADIUS_M = 6378137;
const HALF_PI = Math.PI / 2;

export function webMercatorToLonLat(x: number, y: number): [number, number] {
  const lon = (x / EARTH_RADIUS_M) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - HALF_PI) * (180 / Math.PI);
  return [lon, lat];
}
