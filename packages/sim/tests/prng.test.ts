import { describe, it, expect } from 'vitest';
import { createRng } from '../src/prng.ts';

describe('createRng', () => {
  it('produces deterministic sequences for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(42);
    const b = createRng(43);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('outputs are in [0, 1)', () => {
    const rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('mulberry32 reference: first 3 values for seed=1 match the known sequence', () => {
    // mulberry32 reference values (standard public-domain implementation).
    const rng = createRng(1);
    expect(rng()).toBeCloseTo(0.6270739405881613, 10);
    expect(rng()).toBeCloseTo(0.002735721180215478, 10);
    expect(rng()).toBeCloseTo(0.5274603895843029, 10);
  });
});
