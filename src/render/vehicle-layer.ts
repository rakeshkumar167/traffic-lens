import { IconLayer } from '@deck.gl/layers';
import {
  MAX_VEHICLES, STATE_ACTIVE, VEHICLE_LENGTH_M, type SabViews,
} from '@traffic-lens/shared';
import type { InterpSnapshot } from './interpolation.ts';
import { webMercatorToLonLat } from './projection.ts';
import carAtlas from '../car-sprite.png';

// Sub-image bounding boxes within src/car-sprite.png (1536×1024), one per car.
const CARS = [
  { name: 'red', x: 180, y: 60, width: 200, height: 440 },
  { name: 'blue', x: 450, y: 60, width: 200, height: 440 },
  { name: 'white', x: 720, y: 60, width: 220, height: 450 },
  { name: 'yellow', x: 1010, y: 60, width: 220, height: 440 },
  { name: 'black', x: 180, y: 540, width: 210, height: 410 },
  { name: 'silver', x: 450, y: 540, width: 220, height: 410 },
  { name: 'green', x: 730, y: 550, width: 210, height: 390 },
  { name: 'orange', x: 1010, y: 540, width: 230, height: 410 },
] as const;

const ICON_MAPPING = Object.fromEntries(CARS.map((c) => [
  c.name,
  { x: c.x, y: c.y, width: c.width, height: c.height, anchorX: c.width / 2, anchorY: c.height / 2, mask: false },
]));
const CAR_NAMES = CARS.map((c) => c.name);

interface VehicleDatum {
  readonly slotIdx: number;
}

interface BuildArgs {
  readonly views: SabViews;
  readonly snapshot: InterpSnapshot;
  readonly alpha: number;
  readonly layerId: string;
}

export function buildVehicleLayer({ views, snapshot, alpha, layerId }: BuildArgs): IconLayer<VehicleDatum> {
  // Only feed active vehicles to the IconLayer — rendering all 2000 slots per
  // frame is far too expensive for icons (unlike the old circle layer) and
  // leaves it unable to finish, so most icons never draw.
  const data: VehicleDatum[] = [];
  for (let i = 0; i < MAX_VEHICLES; i++) {
    if (views.state[i] === STATE_ACTIVE) data.push({ slotIdx: i });
  }
  return new IconLayer<VehicleDatum>({
    id: layerId,
    data,
    pickable: false,
    iconAtlas: carAtlas,
    iconMapping: ICON_MAPPING,
    // Stable per-slot car variant so the fleet looks varied.
    getIcon: (d: VehicleDatum) => CAR_NAMES[d.slotIdx % CAR_NAMES.length]!,
    // Icon height = one car length, the same value the sim uses for car-following
    // gaps, so on-map spacing matches the model. Clamp to visible pixels at any zoom.
    sizeUnits: 'meters',
    getSize: VEHICLE_LENGTH_M,
    sizeMinPixels: 14,
    sizeMaxPixels: 48,
    billboard: true,
    getPosition: (d: VehicleDatum) => {
      const i = d.slotIdx;
      const dx = snapshot.curX[i]! - snapshot.prevX[i]!;
      const dy = snapshot.curY[i]! - snapshot.prevY[i]!;
      // A normal per-tick move is well under a metre; a large jump means a spawn,
      // slot reuse, or edge discontinuity — snap to the current position instead
      // of lerping (which would streak the car across the map).
      const a = dx * dx + dy * dy > 25 ? 1 : alpha;
      const [lon, lat] = webMercatorToLonLat(
        snapshot.prevX[i]! + dx * a,
        snapshot.prevY[i]! + dy * a,
      );
      return [lon, lat];
    },
    // heading is radians CCW from east; sprites point up (north), so subtract 90°
    // to align the car's nose with its travel direction. Interpolate along the
    // shortest arc so turns rotate smoothly.
    getAngle: (d: VehicleDatum) => {
      const i = d.slotIdx;
      let diff = snapshot.curHeading[i]! - snapshot.prevHeading[i]!;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const h = snapshot.prevHeading[i]! + diff * alpha;
      return (h * 180) / Math.PI - 90;
    },
    updateTriggers: {
      getPosition: alpha,
      getAngle: alpha,
      getSize: alpha,
    },
  });
}
