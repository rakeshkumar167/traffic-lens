import { describe, it, expect } from 'vitest';
import { lonLatToWebMercator } from '../src/project.ts';

describe('lonLatToWebMercator', () => {
  it('projects (0, 0) to the origin', () => {
    const { x, y } = lonLatToWebMercator(0, 0);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it('projects (180, 0) to the eastern world bound', () => {
    const { x } = lonLatToWebMercator(180, 0);
    // Web Mercator world half-width in metres at equator
    expect(x).toBeCloseTo(20037508.3427892, 4);
  });

  it('projects (-180, 0) to the western world bound', () => {
    const { x } = lonLatToWebMercator(-180, 0);
    expect(x).toBeCloseTo(-20037508.3427892, 4);
  });

  it('projects Koramangala roughly correctly', () => {
    // Spot-check against a known reference: lon 77.6309, lat 12.9352
    // → approx x = 8641832, y = 1452330 in EPSG:3857.
    const { x, y } = lonLatToWebMercator(77.6309, 12.9352);
    expect(x).toBeCloseTo(8641832, -1); // within ±10 m
    expect(y).toBeCloseTo(1452330, -1);
  });
});
