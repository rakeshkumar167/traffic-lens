import { describe, it, expect } from 'vitest';
import type { SignalPlan } from '@traffic-lens/shared';
import {
  createSignalState,
  advanceSignalState,
  isEdgeGreen,
} from '../src/signals.ts';

const PLAN: SignalPlan = {
  cycleSec: 60,
  phases: [
    { greenIncomingEdges: [10], durationSec: 30 },
    { greenIncomingEdges: [20], durationSec: 30 },
  ],
};

describe('signals', () => {
  it('starts in phase 0', () => {
    const s = createSignalState();
    expect(s.phaseIndex).toBe(0);
    expect(s.phaseElapsedSec).toBe(0);
  });

  it('isEdgeGreen reflects the current phase', () => {
    const s = createSignalState();
    expect(isEdgeGreen(s, PLAN, 10)).toBe(true);
    expect(isEdgeGreen(s, PLAN, 20)).toBe(false);
    expect(isEdgeGreen(s, PLAN, 999)).toBe(false);
  });

  it('advanceSignalState flips to phase 1 at the phase boundary', () => {
    const s = createSignalState();
    advanceSignalState(s, PLAN, 29.9);
    expect(s.phaseIndex).toBe(0);
    advanceSignalState(s, PLAN, 0.2);
    expect(s.phaseIndex).toBe(1);
    expect(s.phaseElapsedSec).toBeCloseTo(0.1, 5);
    expect(isEdgeGreen(s, PLAN, 20)).toBe(true);
    expect(isEdgeGreen(s, PLAN, 10)).toBe(false);
  });

  it('wraps phase index back to 0 at the end of the cycle', () => {
    const s = createSignalState();
    advanceSignalState(s, PLAN, 60.1);
    expect(s.phaseIndex).toBe(0);
    expect(s.phaseElapsedSec).toBeCloseTo(0.1, 5);
  });

  it('handles a single-phase plan with no flips', () => {
    const single: SignalPlan = {
      cycleSec: 60,
      phases: [{ greenIncomingEdges: [10], durationSec: 60 }],
    };
    const s = createSignalState();
    advanceSignalState(s, single, 30);
    expect(s.phaseIndex).toBe(0);
    expect(isEdgeGreen(s, single, 10)).toBe(true);
  });

  it('advancing by more than one cycle still leaves a sane state', () => {
    const s = createSignalState();
    advanceSignalState(s, PLAN, 150); // 2.5 cycles
    // 150 mod 60 = 30 → start of phase 1.
    expect(s.phaseIndex).toBe(1);
    expect(s.phaseElapsedSec).toBeCloseTo(0, 5);
  });
});
