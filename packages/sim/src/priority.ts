export interface PriorityApproach {
  readonly distanceToJunction: number; // m, positive — still approaching
  readonly speed: number;              // m/s, positive
}

export interface PriorityParams {
  readonly safetyMarginSec: number;     // we need at least this much head start
  readonly minSightDistanceM: number;   // ignore priority vehicles farther than this
  readonly minPrioritySpeedMps: number; // treat slower-than-this priority vehicles as no conflict
  readonly minSelfSpeedMps: number;     // refuse decision when own speed below this
}

export const DEFAULT_PRIORITY_PARAMS: PriorityParams = {
  safetyMarginSec: 2.0,
  minSightDistanceM: 80,
  minPrioritySpeedMps: 0.5,
  minSelfSpeedMps: 0.5,
};

export interface PriorityInput {
  readonly selfDistanceToJunction: number;
  readonly selfSpeed: number;
  readonly priorityApproaches: readonly PriorityApproach[];
  readonly params: PriorityParams;
}

export function canEnterPriorityJunction(input: PriorityInput): boolean {
  const { selfDistanceToJunction, selfSpeed, priorityApproaches, params } = input;
  // Clamp own speed to a minimum "creep" speed rather than refusing when stopped.
  // A vehicle at rest still needs to proceed once the way is clear; refusing
  // outright deadlocks it (it can never reach minSelfSpeedMps while held).
  const effSpeed = Math.max(selfSpeed, params.minSelfSpeedMps);
  const tSelf = selfDistanceToJunction / effSpeed;
  for (const other of priorityApproaches) {
    if (other.distanceToJunction > params.minSightDistanceM) continue;
    if (other.speed < params.minPrioritySpeedMps) continue;
    const tOther = other.distanceToJunction / other.speed;
    if (tSelf + params.safetyMarginSec >= tOther) return false;
  }
  return true;
}
