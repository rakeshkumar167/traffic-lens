import { describe, it, expect } from 'vitest';
import { idmAcceleration, DEFAULT_IDM_PARAMS } from '../src/idm.ts';

describe('idmAcceleration', () => {
  const p = DEFAULT_IDM_PARAMS;

  it('on a free road at rest, accelerates positively toward v0', () => {
    const a = idmAcceleration({ speed: 0, leaderSpeed: 0, gap: Infinity, v0: 14, params: p });
    expect(a).toBeCloseTo(p.a, 5);
  });

  it('on a free road already at v0, acceleration is ~0', () => {
    const a = idmAcceleration({ speed: 14, leaderSpeed: 0, gap: Infinity, v0: 14, params: p });
    expect(a).toBeCloseTo(0, 5);
  });

  it('above v0 on a free road, decelerates', () => {
    const a = idmAcceleration({ speed: 20, leaderSpeed: 0, gap: Infinity, v0: 14, params: p });
    expect(a).toBeLessThan(0);
  });

  it('approaching a stopped leader at close range, decelerates hard', () => {
    const a = idmAcceleration({ speed: 14, leaderSpeed: 0, gap: 5, v0: 14, params: p });
    expect(a).toBeLessThan(-p.b);
  });

  it('matched speed at the safe headway distance: gentle adjustment', () => {
    // Equilibrium distance: s* = s0 + v*T  →  v=10, T=1.5, s0=2  →  17 m.
    const a = idmAcceleration({ speed: 10, leaderSpeed: 10, gap: 17, v0: 14, params: p });
    expect(Math.abs(a)).toBeLessThan(0.2);
  });

  it('at the jam gap with zero speed, acceleration is ~0', () => {
    const a = idmAcceleration({ speed: 0, leaderSpeed: 0, gap: p.s0, v0: 14, params: p });
    expect(Math.abs(a)).toBeLessThan(0.1);
  });

  it('symmetry: when leader matches speed at very large gap, accel ≈ free-flow accel', () => {
    const free = idmAcceleration({ speed: 5, leaderSpeed: 5, gap: Infinity, v0: 14, params: p });
    const far  = idmAcceleration({ speed: 5, leaderSpeed: 5, gap: 1000, v0: 14, params: p });
    expect(Math.abs(free - far)).toBeLessThan(0.05);
  });
});
