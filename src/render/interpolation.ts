import { MAX_VEHICLES, type SabViews } from '@traffic-lens/shared';

const TICK_MS = 1000 / 30; // 30 Hz sim — initial guess for the inter-tick interval

export interface InterpSnapshot {
  // Positions/headings captured at the previous and current observed sim ticks.
  // Rendering lerps prev → cur over the wall-clock interval between them, which
  // smooths motion regardless of (and lagging by one tick behind) the sim.
  // posX/posY are Float64 to match the SAB: absolute Web Mercator world metres
  // need more than Float32's ~1 m resolution at Bangalore magnitudes.
  prevX: Float64Array;
  prevY: Float64Array;
  prevHeading: Float32Array;
  curX: Float64Array;
  curY: Float64Array;
  curHeading: Float32Array;
  tickNumber: number;
  capturedAtMs: number;
  tickIntervalMs: number; // measured interval between the last two ticks
}

export function createSnapshot(): InterpSnapshot {
  return {
    prevX: new Float64Array(MAX_VEHICLES),
    prevY: new Float64Array(MAX_VEHICLES),
    prevHeading: new Float32Array(MAX_VEHICLES),
    curX: new Float64Array(MAX_VEHICLES),
    curY: new Float64Array(MAX_VEHICLES),
    curHeading: new Float32Array(MAX_VEHICLES),
    tickNumber: -1,
    capturedAtMs: 0,
    tickIntervalMs: TICK_MS,
  };
}

// Returns the interpolation alpha (0..1) for the current frame. Side-effect:
// when the SAB tick has advanced, shifts cur → prev and captures the new cur.
export function updateSnapshotAndAlpha(
  snapshot: InterpSnapshot,
  views: SabViews,
  nowMs: number,
): number {
  const sabTick = views.control.tickNumber[0]!;
  if (sabTick !== snapshot.tickNumber) {
    if (snapshot.tickNumber < 0) {
      // First observation — no history, so prev = cur (render static this tick).
      snapshot.prevX.set(views.posX);
      snapshot.prevY.set(views.posY);
      snapshot.prevHeading.set(views.heading);
    } else {
      const interval = nowMs - snapshot.capturedAtMs;
      if (interval > 0) snapshot.tickIntervalMs = interval;
      snapshot.prevX.set(snapshot.curX);
      snapshot.prevY.set(snapshot.curY);
      snapshot.prevHeading.set(snapshot.curHeading);
    }
    snapshot.curX.set(views.posX);
    snapshot.curY.set(views.posY);
    snapshot.curHeading.set(views.heading);
    snapshot.tickNumber = sabTick;
    snapshot.capturedAtMs = nowMs;
    return 0;
  }
  return Math.min(1, (nowMs - snapshot.capturedAtMs) / snapshot.tickIntervalMs);
}
