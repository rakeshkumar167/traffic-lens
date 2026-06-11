import type { Point2D } from '@traffic-lens/shared';

// EPSG:3857 (Web Mercator) projection of (lon, lat) in degrees to (x, y) in metres.
// Formulas from https://en.wikipedia.org/wiki/Web_Mercator_projection.
const EARTH_RADIUS_M = 6378137;
const DEG_TO_RAD = Math.PI / 180;

export function lonLatToWebMercator(lon: number, lat: number): Point2D {
  const x = EARTH_RADIUS_M * lon * DEG_TO_RAD;
  const y = EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (lat * DEG_TO_RAD) / 2));
  return { x, y };
}
