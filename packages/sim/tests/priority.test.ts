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

  it('lets a stopped vehicle enter once the way is clear (no give-way deadlock)', () => {
    // A vehicle that has come to rest at the line must be able to proceed when
    // there is no conflicting priority traffic — otherwise it deadlocks forever.
    expect(canEnterPriorityJunction({
      selfDistanceToJunction: 2,
      selfSpeed: 0,
      priorityApproaches: [{ distanceToJunction: 100, speed: 10 }], // out of sight (>80 m)
      params: p,
    })).toBe(true);
  });

  it('still makes a stopped vehicle yield to a close, fast priority vehicle', () => {
    expect(canEnterPriorityJunction({
      selfDistanceToJunction: 2,
      selfSpeed: 0,
      priorityApproaches: [{ distanceToJunction: 10, speed: 10 }],
      params: p,
    })).toBe(false);
  });
});
