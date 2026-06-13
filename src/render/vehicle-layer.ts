import { ScatterplotLayer } from '@deck.gl/layers';
import {
  MAX_VEHICLES, STATE_ACTIVE, type SabViews,
} from '@traffic-lens/shared';
import type { InterpSnapshot } from './interpolation.ts';

const EARTH_RADIUS_M = 6378137;
const HALF_PI = Math.PI / 2;

// Inverse of Plan A's lonLatToWebMercator.
function webMercatorToLonLat(x: number, y: number): [number, number] {
  const lon = (x / EARTH_RADIUS_M) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - HALF_PI) * (180 / Math.PI);
  return [lon, lat];
}

interface VehicleDatum {
  readonly slotIdx: number;
}

const DATA: VehicleDatum[] = Array.from({ length: MAX_VEHICLES }, (_, i) => ({ slotIdx: i }));

interface BuildArgs {
  readonly views: SabViews;
  readonly snapshot: InterpSnapshot;
  readonly alpha: number;
  readonly layerId: string;
}

export function buildVehicleLayer({ views, snapshot, alpha, layerId }: BuildArgs): ScatterplotLayer<VehicleDatum> {
  return new ScatterplotLayer<VehicleDatum>({
    id: layerId,
    data: DATA,
    pickable: false,
    radiusUnits: 'meters',
    // Real-world car footprint is ~2.5 m wide, but at zoom 15 that's
    // sub-pixel. Clamp to a visible screen-pixel range so vehicles are
    // always discoverable at any zoom level.
    radiusMinPixels: 4,
    radiusMaxPixels: 14,
    stroked: true,
    lineWidthMinPixels: 1,
    getLineColor: [10, 10, 20, 220],
    getRadius: (d: VehicleDatum) =>
      views.state[d.slotIdx] === STATE_ACTIVE ? 3.5 : 0,
    getPosition: (d: VehicleDatum) => {
      const i = d.slotIdx;
      const x = snapshot.posX[i]! + (views.posX[i]! - snapshot.posX[i]!) * alpha;
      const y = snapshot.posY[i]! + (views.posY[i]! - snapshot.posY[i]!) * alpha;
      const [lon, lat] = webMercatorToLonLat(x, y);
      return [lon, lat];
    },
    getFillColor: (d: VehicleDatum) => {
      // Colour by speed (m/s) on a red → amber → blue ramp.
      // 0 m/s = red (stopped), ~7 m/s = amber (mid), 14 m/s = #1F75FE (free-flow).
      const speed = views.speed[d.slotIdx]!;
      const t = Math.max(0, Math.min(1, speed / 14));
      const lerp = (a: number, b: number, u: number) => Math.round(a + (b - a) * u);
      if (t < 0.5) {
        // red (220,45,40) → amber (255,176,0)
        const u = t / 0.5;
        return [lerp(220, 255, u), lerp(45, 176, u), lerp(40, 0, u), 230];
      }
      // amber (255,176,0) → blue #1F75FE (31,117,254)
      const u = (t - 0.5) / 0.5;
      return [lerp(255, 31, u), lerp(176, 117, u), lerp(0, 254, u), 230];
    },
    updateTriggers: {
      getRadius: alpha,
      getPosition: alpha,
      getFillColor: alpha,
    },
  });
}
