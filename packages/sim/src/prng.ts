// Mulberry32 — a tiny, fast, deterministic 32-bit PRNG with good distribution
// for our needs (spawn timing, route weights, micro-variation). Public domain.
//
// Returns a function that yields a Float64 in [0, 1) per call.
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
