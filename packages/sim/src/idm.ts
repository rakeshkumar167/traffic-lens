// Intelligent Driver Model (Treiber, Hennecke, Helbing 2000).
// Pure function: given current vehicle speed, leader speed, gap to leader, and
// per-vehicle parameters, returns desired acceleration in m/s².
//
// Reference: dv/dt = a · (1 − (v/v0)^δ − (s*(v, Δv) / s)^2)
//   where s*(v, Δv) = s0 + max(0, v·T + v·Δv / (2·√(a·b)))

export interface IdmParams {
  readonly a: number;   // max accel  (m/s²)
  readonly b: number;   // comfort decel (m/s²) — positive number
  readonly T: number;   // safe time headway (s)
  readonly s0: number;  // minimum jam distance (m)
  readonly delta: number; // exponent on free-flow term (usually 4)
}

export const DEFAULT_IDM_PARAMS: IdmParams = {
  a: 1.5,
  b: 2.0,
  T: 1.5,
  s0: 2.0,
  delta: 4,
};

export interface IdmInput {
  readonly speed: number;       // current vehicle speed (m/s)
  readonly leaderSpeed: number; // leader vehicle speed (m/s); irrelevant if no leader
  readonly gap: number;         // bumper-to-bumper gap to leader (m); Infinity if none
  readonly v0: number;          // desired speed on this edge (m/s)
  readonly params: IdmParams;
}

export function idmAcceleration(input: IdmInput): number {
  const { speed, leaderSpeed, gap, v0, params } = input;
  const { a, b, T, s0, delta } = params;

  const freeTerm = Math.pow(Math.max(speed, 0) / v0, delta);

  if (!Number.isFinite(gap)) {
    return a * (1 - freeTerm);
  }

  const dv = speed - leaderSpeed;
  const freeSqrt = Math.sqrt(Math.max(0, 1 - freeTerm));
  const sStar = s0 + Math.max(0, speed * T * freeSqrt + (speed * dv) / (2 * Math.sqrt(a * b)));
  const interactionTerm = Math.pow(sStar / Math.max(gap, 0.001), 2);
  return a * (1 - freeTerm - interactionTerm);
}
