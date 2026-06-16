// SharedArrayBuffer layout shared by the sim worker (writer) and the main-thread
// renderer (reader). All per-vehicle arrays are struct-of-arrays. The control
// region is fixed-size at the start; per-vehicle field blocks follow, each
// padded out to 8-byte alignment so the next view is safe to construct.

export const MAX_VEHICLES = 2000;

// Vehicle slot lifecycle codes (Uint8 in SAB).
export const STATE_FREE = 0;
export const STATE_ACTIVE = 1;
export const STATE_DESPAWNING = 2;

// Vehicle type codes (Uint16 in SAB). Slice ships cars only.
export const VEHICLE_TYPE_CAR = 0;

// Internal: field byte sizes. Each field block is MAX_VEHICLES * elementSize,
// rounded up to 8 bytes so the following Float64-or-larger view is aligned.
const F64_SIZE = 8;
const F32_SIZE = 4;
const U32_SIZE = 4;
const U16_SIZE = 2;
const U8_SIZE = 1;

function padTo8(n: number): number {
  return Math.ceil(n / 8) * 8;
}

// Control region layout. Always at byte offset 0.
//   Uint32  tickNumber           @ 0
//   Uint32  reserved             @ 4   (align Float64)
//   Float64 simWallClockSec      @ 8
//   Uint32  activeSnapshotIdx    @ 16  (reserved for future double-buffering)
//   Uint32  reserved             @ 20
//   8 bytes reserved             @ 24
const CONTROL_BYTES = 32;

// Per-vehicle field block byte sizes (each padded to 8B alignment).
// posX/posY are Float64: vehicle geometry is absolute Web Mercator world metres
// (~8.6e6 in Bangalore), where Float32 only resolves ~1 m, quantizing positions
// into a visible staircase. The other fields are local-magnitude and fit in F32.
const POS_X_BYTES        = padTo8(MAX_VEHICLES * F64_SIZE);
const POS_Y_BYTES        = padTo8(MAX_VEHICLES * F64_SIZE);
const HEADING_BYTES      = padTo8(MAX_VEHICLES * F32_SIZE);
const SPEED_BYTES        = padTo8(MAX_VEHICLES * F32_SIZE);
const ACCEL_BYTES        = padTo8(MAX_VEHICLES * F32_SIZE);
const EDGE_ID_BYTES      = padTo8(MAX_VEHICLES * U32_SIZE);
const EDGE_PROGRESS_BYTES = padTo8(MAX_VEHICLES * F32_SIZE);
const LANE_BYTES         = padTo8(MAX_VEHICLES * U8_SIZE);
const STATE_BYTES        = padTo8(MAX_VEHICLES * U8_SIZE);
const VEHICLE_TYPE_BYTES = padTo8(MAX_VEHICLES * U16_SIZE);
const ROUTE_IDX_BYTES    = padTo8(MAX_VEHICLES * U16_SIZE);

// Field offsets in the SAB.
const POS_X_OFFSET        = CONTROL_BYTES;
const POS_Y_OFFSET        = POS_X_OFFSET + POS_X_BYTES;
const HEADING_OFFSET      = POS_Y_OFFSET + POS_Y_BYTES;
const SPEED_OFFSET        = HEADING_OFFSET + HEADING_BYTES;
const ACCEL_OFFSET        = SPEED_OFFSET + SPEED_BYTES;
const EDGE_ID_OFFSET      = ACCEL_OFFSET + ACCEL_BYTES;
const EDGE_PROGRESS_OFFSET = EDGE_ID_OFFSET + EDGE_ID_BYTES;
const LANE_OFFSET         = EDGE_PROGRESS_OFFSET + EDGE_PROGRESS_BYTES;
const STATE_OFFSET        = LANE_OFFSET + LANE_BYTES;
const VEHICLE_TYPE_OFFSET = STATE_OFFSET + STATE_BYTES;
const ROUTE_IDX_OFFSET    = VEHICLE_TYPE_OFFSET + VEHICLE_TYPE_BYTES;
const TOTAL_BYTES         = ROUTE_IDX_OFFSET + ROUTE_IDX_BYTES;

export function computeSabByteLength(): number {
  return TOTAL_BYTES;
}

export interface SabControlViews {
  readonly tickNumber: Uint32Array;
  readonly simWallClockSec: Float64Array;
  readonly activeSnapshotIdx: Uint32Array;
}

export interface SabViews {
  readonly control: SabControlViews;
  readonly posX: Float64Array;
  readonly posY: Float64Array;
  readonly heading: Float32Array;
  readonly speed: Float32Array;
  readonly accel: Float32Array;
  readonly edgeId: Uint32Array;
  readonly edgeProgress: Float32Array;
  readonly lane: Uint8Array;
  readonly state: Uint8Array;
  readonly vehicleType: Uint16Array;
  readonly routeIdx: Uint16Array;
}

export function createSabViews(sab: SharedArrayBuffer): SabViews {
  return {
    control: {
      tickNumber: new Uint32Array(sab, 0, 1),
      simWallClockSec: new Float64Array(sab, 8, 1),
      activeSnapshotIdx: new Uint32Array(sab, 16, 1),
    },
    posX: new Float64Array(sab, POS_X_OFFSET, MAX_VEHICLES),
    posY: new Float64Array(sab, POS_Y_OFFSET, MAX_VEHICLES),
    heading: new Float32Array(sab, HEADING_OFFSET, MAX_VEHICLES),
    speed: new Float32Array(sab, SPEED_OFFSET, MAX_VEHICLES),
    accel: new Float32Array(sab, ACCEL_OFFSET, MAX_VEHICLES),
    edgeId: new Uint32Array(sab, EDGE_ID_OFFSET, MAX_VEHICLES),
    edgeProgress: new Float32Array(sab, EDGE_PROGRESS_OFFSET, MAX_VEHICLES),
    lane: new Uint8Array(sab, LANE_OFFSET, MAX_VEHICLES),
    state: new Uint8Array(sab, STATE_OFFSET, MAX_VEHICLES),
    vehicleType: new Uint16Array(sab, VEHICLE_TYPE_OFFSET, MAX_VEHICLES),
    routeIdx: new Uint16Array(sab, ROUTE_IDX_OFFSET, MAX_VEHICLES),
  };
}
