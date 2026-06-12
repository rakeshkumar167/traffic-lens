import { describe, it, expect } from 'vitest';
import { canEnterPriorityJunction, DEFAULT_PRIORITY_PARAMS } from '../src/priority.ts';

const p = DEFAULT_PRIORITY_PARAMS;

describe('canEnterPriorityJunction', () => {
  it('accepts when there are no priority-edge vehicles', () => {
    expect(canEnterPriorityJunction({
      selfDistanceToJunction: 10,
      selfSpeed: 5,
      priorityApproaches: [],
      params: p,
    })).toBe(true);
  });

  it('rejects when a priority vehicle is closing in faster than our gap', () => {
    expect(canEnterPriorityJunction({
      selfDistanceToJunction: 20,
      selfSpeed: 5,
      priorityApproaches: [{ distanceToJunction: 8, speed: 8 }],
      params: p,
    })).toBe(false);
  });

  it('accepts when the priority vehicle is far enough to satisfy safety margin', () => {
    expect(canEnterPriorityJunction({
      selfDistanceToJunction: 8,
      selfSpeed: 5,
      priorityApproaches: [{ distanceToJunction: 80, speed: 10 }],
      params: p,
    })).toBe(true);
  });

  it('treats a stopped priority vehicle as no conflict', () => {
    expect(canEnterPriorityJunction({
      selfDistanceToJunction: 10,
      selfSpeed: 5,
      priorityApproaches: [{ distanceToJunction: 5, speed: 0 }],
      params: p,
    })).toBe(true);
  });

  it('with self at zero speed, rejects (avoid divide-by-zero misuse)', () => {
    // We model "yielding at the line" — vehicle at rest can't sensibly compute
    // its own time-to-junction, so refuse and let IDM hold it there.
    expect(canEnterPriorityJunction({
      selfDistanceToJunction: 0.1,
      selfSpeed: 0,
      priorityApproaches: [{ distanceToJunction: 100, speed: 10 }],
      params: p,
    })).toBe(false);
  });
});
