import { describe, it, expect } from 'vitest';
import { mobilDecision, DEFAULT_MOBIL_PARAMS } from '../src/mobil.ts';
import { DEFAULT_IDM_PARAMS } from '../src/idm.ts';

const baseSelf = {
  speed: 10,
  v0: 14,
};

const noNeighbor = { speed: 14, gap: Infinity };

function input(overrides: Partial<{
  currentLeader: { speed: number; gap: number };
  newLaneLeader: { speed: number; gap: number };
  newLaneFollower: { speed: number; gap: number; v0: number };
  oldLaneFollower: { speed: number; gap: number; v0: number };
  mandatoryBias: number;
}>) {
  return {
    self: baseSelf,
    currentLeader: overrides.currentLeader ?? noNeighbor,
    newLaneLeader: overrides.newLaneLeader ?? noNeighbor,
    newLaneFollower: overrides.newLaneFollower
      ? { ...overrides.newLaneFollower }
      : { speed: 10, gap: Infinity, v0: 14 },
    oldLaneFollower: overrides.oldLaneFollower
      ? { ...overrides.oldLaneFollower }
      : { speed: 10, gap: Infinity, v0: 14 },
    mandatoryBias: overrides.mandatoryBias ?? 0,
    idm: DEFAULT_IDM_PARAMS,
    mobil: DEFAULT_MOBIL_PARAMS,
  };
}

describe('mobilDecision', () => {
  it('accepts a change when current lane is blocked and new lane is clear', () => {
    expect(
      mobilDecision(input({
        currentLeader: { speed: 0, gap: 8 },
        newLaneLeader: noNeighbor,
      })),
    ).toBe(true);
  });

  it('rejects a change when new lane has a close stopped leader', () => {
    expect(
      mobilDecision(input({
        currentLeader: { speed: 14, gap: 50 },
        newLaneLeader: { speed: 0, gap: 5 },
      })),
    ).toBe(false);
  });

  it('rejects a change that would force the new follower to brake hard', () => {
    expect(
      mobilDecision(input({
        currentLeader: { speed: 14, gap: 200 },
        newLaneLeader: { speed: 14, gap: 200 },
        newLaneFollower: { speed: 14, gap: 3, v0: 14 },
      })),
    ).toBe(false);
  });

  it('rejects a change when neither lane is meaningfully different', () => {
    expect(
      mobilDecision(input({
        currentLeader: { speed: 14, gap: 100 },
        newLaneLeader: { speed: 14, gap: 100 },
      })),
    ).toBe(false);
  });

  it('mandatoryBias forces an otherwise-marginal change', () => {
    // Tiny benefit normally below threshold.
    const marginal = input({
      currentLeader: { speed: 12, gap: 30 },
      newLaneLeader: { speed: 14, gap: 50 },
    });
    expect(mobilDecision(marginal)).toBe(false);

    const withBias = { ...marginal, mandatoryBias: 2.0 };
    expect(mobilDecision(withBias)).toBe(true);
  });
});
