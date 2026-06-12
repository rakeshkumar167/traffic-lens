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
    getRadius: (d: VehicleDatum) =>
      views.state[d.slotIdx] === STATE_ACTIVE ? 2.5 : 0,
    getPosition: (d: VehicleDatum) => {
      const i = d.slotIdx;
      const x = snapshot.posX[i]! + (views.posX[i]! - snapshot.posX[i]!) * alpha;
      const y = snapshot.posY[i]! + (views.posY[i]! - snapshot.posY[i]!) * alpha;
      const [lon, lat] = webMercatorToLonLat(x, y);
      return [lon, lat];
    },
    getFillColor: (d: VehicleDatum) => {
      // Colour by speed (m/s). 0 → red, 14 → green.
      const speed = views.speed[d.slotIdx]!;
      const t = Math.max(0, Math.min(1, speed / 14));
      const r = Math.round(255 * (1 - t));
      const g = Math.round(255 * t);
      return [r, g, 40, 230];
    },
    updateTriggers: {
      getRadius: alpha,
      getPosition: alpha,
      getFillColor: alpha,
    },
  });
}
