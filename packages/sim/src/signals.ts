import type { EdgeId, SignalPlan } from '@traffic-lens/shared';

export interface SignalState {
  phaseIndex: number;
  phaseElapsedSec: number;
}

export function createSignalState(): SignalState {
  return { phaseIndex: 0, phaseElapsedSec: 0 };
}

export function advanceSignalState(
  state: SignalState,
  plan: SignalPlan,
  dt: number,
): void {
  if (plan.phases.length === 0) return;
  // Convert absolute cycle time, advance, then re-derive index + within-phase.
  let totalElapsed = 0;
  for (let i = 0; i < state.phaseIndex; i++) {
    totalElapsed += plan.phases[i]!.durationSec;
  }
  totalElapsed += state.phaseElapsedSec + dt;
  const cycle = plan.cycleSec;
  if (cycle <= 0) return;
  totalElapsed = ((totalElapsed % cycle) + cycle) % cycle;

  let acc = 0;
  for (let i = 0; i < plan.phases.length; i++) {
    const dur = plan.phases[i]!.durationSec;
    if (totalElapsed < acc + dur) {
      state.phaseIndex = i;
      state.phaseElapsedSec = totalElapsed - acc;
      return;
    }
    acc += dur;
  }
  // Numerical tail (e.g. totalElapsed === cycle exactly) → land on phase 0.
  state.phaseIndex = 0;
  state.phaseElapsedSec = 0;
}

export function isEdgeGreen(
  state: SignalState,
  plan: SignalPlan,
  edgeId: EdgeId,
): boolean {
  const phase = plan.phases[state.phaseIndex];
  if (!phase) return false;
  return phase.greenIncomingEdges.includes(edgeId);
}
