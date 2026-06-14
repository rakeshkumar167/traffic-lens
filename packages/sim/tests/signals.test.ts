import { describe, it, expect } from 'vitest';
import type { SignalPlan } from '@traffic-lens/shared';
import {
  createSignalState,
  advanceSignalState,
  isEdgeGreen,
  greenIncomingEdgesAt,
  signalStateAt,
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

  describe('greenIncomingEdgesAt', () => {
    it('returns the active phase edges across the cycle', () => {
      expect(greenIncomingEdgesAt(PLAN, 0)).toEqual([10]);
      expect(greenIncomingEdgesAt(PLAN, 29.9)).toEqual([10]);
      expect(greenIncomingEdgesAt(PLAN, 30)).toEqual([20]);
      expect(greenIncomingEdgesAt(PLAN, 59.9)).toEqual([20]);
      expect(greenIncomingEdgesAt(PLAN, 60)).toEqual([10]); // wraps
      expect(greenIncomingEdgesAt(PLAN, 90)).toEqual([20]); // 1.5 cycles
    });

    it('returns [] for an empty plan', () => {
      expect(greenIncomingEdgesAt({ cycleSec: 60, phases: [] }, 5)).toEqual([]);
    });
  });

  describe('signalStateAt', () => {
    const amber = 3;
    it('is green mid-phase, amber in the last few seconds, red otherwise', () => {
      expect(signalStateAt(PLAN, 10, 0, amber)).toBe('green');   // start of A's green
      expect(signalStateAt(PLAN, 10, 28, amber)).toBe('amber');  // A ends at 30 → within amber
      expect(signalStateAt(PLAN, 10, 35, amber)).toBe('red');    // phase B
      expect(signalStateAt(PLAN, 20, 0, amber)).toBe('red');     // B not green yet
      expect(signalStateAt(PLAN, 20, 58, amber)).toBe('amber');  // B ends at 60 (wraps) → amber
    });

    it('agrees with advanceSignalState + isEdgeGreen at sampled times', () => {
      for (const t of [0, 5, 15, 29, 30, 31, 45, 59, 61, 119, 121]) {
        const s = createSignalState();
        advanceSignalState(s, PLAN, t);
        for (const edge of [10, 20]) {
          expect(greenIncomingEdgesAt(PLAN, t).includes(edge)).toBe(isEdgeGreen(s, PLAN, edge));
        }
      }
    });
  });
});
