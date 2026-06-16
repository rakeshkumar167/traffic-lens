import { IconLayer } from '@deck.gl/layers';
import {
  MAX_VEHICLES, STATE_ACTIVE, VEHICLE_LENGTH_M, type SabViews,
} from '@traffic-lens/shared';
import type { InterpSnapshot } from './interpolation.ts';
import { webMercatorToLonLat } from './projection.ts';
import vehicleAtlas from '../vehicle-sprite.png';

// Tight pixel bounding boxes within src/vehicle-sprite.png.
// Rows 1–4: all 95×176 px. Row 5 (heavy vehicles): 133×240 px.
const VEHICLES = [
  // Row 1 — Sedans & Trucks
  { name: 'red-sedan-1',     x: 60,   y: 27,  w: 95,  h: 176 },
  { name: 'blue-sedan-1',    x: 198,  y: 27,  w: 95,  h: 176 },
  { name: 'white-sedan-1',   x: 331,  y: 24,  w: 95,  h: 176 },
  { name: 'black-suv-1',     x: 462,  y: 22,  w: 95,  h: 176 },
  { name: 'silver-sedan',    x: 595,  y: 22,  w: 95,  h: 176 },
  { name: 'orange-sedan-1',  x: 723,  y: 23,  w: 95,  h: 176 },
  { name: 'green-sedan',     x: 850,  y: 21,  w: 95,  h: 176 },
  { name: 'white-sedan-2',   x: 972,  y: 25,  w: 95,  h: 176 },
  { name: 'police-car',      x: 1102, y: 24,  w: 95,  h: 176 },
  { name: 'container-truck', x: 1341, y: 28,  w: 95,  h: 176 },
  // Row 2 — Sedans, SUV, Taxi & Van (slot 17 not measured, skipped)
  { name: 'red-sedan-2',     x: 59,   y: 225, w: 95,  h: 176 },
  { name: 'blue-sedan-2',    x: 197,  y: 222, w: 95,  h: 176 },
  { name: 'white-sedan-3',   x: 332,  y: 223, w: 95,  h: 176 },
  { name: 'yellow-sedan',    x: 463,  y: 223, w: 95,  h: 176 },
  { name: 'orange-sedan-2',  x: 588,  y: 223, w: 95,  h: 176 },
  { name: 'red-sedan-3',     x: 719,  y: 223, w: 95,  h: 176 },
  { name: 'white-sedan-4',   x: 847,  y: 223, w: 95,  h: 176 },
  { name: 'black-suv-2',     x: 1093, y: 222, w: 95,  h: 176 },
  { name: 'taxi',            x: 1212, y: 227, w: 95,  h: 176 },
  { name: 'white-van',       x: 1343, y: 233, w: 95,  h: 176 },
  // Row 3 — Emergency, Rickshaws & Delivery
  { name: 'ambulance',       x: 32,   y: 401, w: 95,  h: 176 },
  { name: 'auto-rickshaw-1', x: 202,  y: 407, w: 95,  h: 176 },
  { name: 'auto-rickshaw-2', x: 337,  y: 409, w: 95,  h: 176 },
  { name: 'e-rickshaw',      x: 469,  y: 412, w: 95,  h: 176 },
  { name: 'swiggy-bike',     x: 601,  y: 420, w: 95,  h: 176 },
  { name: 'delivery-bike',   x: 731,  y: 418, w: 95,  h: 176 },
  { name: 'zomato-bike',     x: 853,  y: 415, w: 95,  h: 176 },
  { name: 'delivery-van',    x: 995,  y: 413, w: 95,  h: 176 },
  { name: 'police-suv',      x: 1161, y: 415, w: 95,  h: 176 },
  { name: 'utility-vehicle', x: 1332, y: 419, w: 95,  h: 176 },
  // Row 4 — Motorcycles, Scooters & Cyclists
  { name: 'moto-red',        x: 19,   y: 576, w: 95,  h: 176 },
  { name: 'moto-blue',       x: 172,  y: 590, w: 95,  h: 176 },
  { name: 'moto-black',      x: 299,  y: 590, w: 95,  h: 176 },
  { name: 'moto-green',      x: 419,  y: 591, w: 95,  h: 176 },
  { name: 'scooter-white',   x: 667,  y: 590, w: 95,  h: 176 },
  { name: 'scooter-red',     x: 780,  y: 589, w: 95,  h: 176 },
  { name: 'scooter-blue',    x: 892,  y: 588, w: 95,  h: 176 },
  { name: 'scooter-black',   x: 1006, y: 588, w: 95,  h: 176 },
  { name: 'cyclist-blue',    x: 1140, y: 592, w: 95,  h: 176 },
  { name: 'cyclist-pink',    x: 1258, y: 590, w: 95,  h: 176 },
  { name: 'cyclist-green',   x: 1369, y: 595, w: 95,  h: 176 },
  // Row 5 — Heavy Vehicles (133×240)
  { name: 'school-bus',      x: 36,   y: 771, w: 133, h: 240 },
  { name: 'city-bus',        x: 174,  y: 771, w: 133, h: 240 },
  { name: 'cargo-truck',     x: 316,  y: 776, w: 133, h: 240 },
  { name: 'box-truck',       x: 446,  y: 774, w: 133, h: 240 },
  { name: 'garbage-truck',   x: 583,  y: 779, w: 133, h: 240 },
  { name: 'fire-truck',      x: 727,  y: 773, w: 133, h: 240 },
  { name: 'cement-mixer',    x: 862,  y: 775, w: 133, h: 240 },
  { name: 'tanker-truck',    x: 1006, y: 776, w: 133, h: 240 },
  { name: 'rv',              x: 1152, y: 778, w: 133, h: 240 },
  { name: 'car-carrier',     x: 1298, y: 783, w: 133, h: 240 },
] as const;

const ICON_MAPPING = Object.fromEntries(VEHICLES.map((v) => [
  v.name,
  { x: v.x, y: v.y, width: v.w, height: v.h, anchorX: v.w / 2, anchorY: v.h / 2, mask: false },
]));
const VEHICLE_NAMES = VEHICLES.map((v) => v.name);

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
    iconAtlas: vehicleAtlas,
    iconMapping: ICON_MAPPING,
    // Stable per-slot variant so the fleet looks varied across all 50 types.
    getIcon: (d: VehicleDatum) => VEHICLE_NAMES[d.slotIdx % VEHICLE_NAMES.length]!,
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
    // to align the vehicle's nose with its travel direction. Interpolate along the
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
