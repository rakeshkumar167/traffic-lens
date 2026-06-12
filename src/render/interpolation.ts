import { MAX_VEHICLES, type SabViews } from '@traffic-lens/shared';

const TICK_MS = 1000 / 30; // 30 Hz sim

export interface InterpSnapshot {
  posX: Float32Array;
  posY: Float32Array;
  heading: Float32Array;
  tickNumber: number;
  capturedAtMs: number;
}

export function createSnapshot(): InterpSnapshot {
  return {
    posX: new Float32Array(MAX_VEHICLES),
    posY: new Float32Array(MAX_VEHICLES),
    heading: new Float32Array(MAX_VEHICLES),
    tickNumber: 0,
    capturedAtMs: 0,
  };
}

// Returns the interpolation alpha (0..1) for the current frame.
// Side-effect: when the SAB tickNumber has advanced past `snapshot.tickNumber`,
// copies the SAB's current positions into the snapshot before returning.
export function updateSnapshotAndAlpha(
  snapshot: InterpSnapshot,
  views: SabViews,
  nowMs: number,
): number {
  const sabTick = views.control.tickNumber[0]!;
  if (sabTick !== snapshot.tickNumber) {
    // New tick observed — capture *current* SAB state as the new "previous".
    snapshot.posX.set(views.posX);
    snapshot.posY.set(views.posY);
    snapshot.heading.set(views.heading);
    snapshot.tickNumber = sabTick;
    snapshot.capturedAtMs = nowMs;
    return 0;
  }
  const elapsedMs = nowMs - snapshot.capturedAtMs;
  return Math.min(1, elapsedMs / TICK_MS);
}
