# Plan B — Headless Sim Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/sim/` — a deterministic, headless traffic simulator that reads the `RoadGraph` emitted by Plan A and a hand-authored demand JSON, advances vehicle physics (IDM + MOBIL + signals + priority-yield) at 30 Hz, and writes vehicle state into a `SharedArrayBuffer`. The sim must run end-to-end under Vitest in Node — no DOM, no rendering. Plus additions to `packages/shared/` for SAB layout, demand types, and worker message protocol.

**Architecture:** Three sub-layers within `packages/sim/`:
1. **Pure-function physics** (`idm.ts`, `mobil.ts`, `signals.ts`, `priority.ts`) — no I/O, no state, easy to test against published reference values.
2. **State containers** (`vehicle-store.ts`, `perception.ts`, `routing.ts`, `spawn.ts`) — own working state; tickable.
3. **Orchestration** (`world.ts` + `tick.ts` + `worker.ts`) — wires it all together; the Web Worker entry stays a thin shell that calls `tick()`.

The SAB is single-buffered for Plan B (simpler; Plan C revisits double-buffering only if the renderer's interpolation needs it). Working sim state lives in plain `Float32Array`s inside the worker; we copy into SAB views at end of tick.

**Tech Stack:** TypeScript 5.5+ strict, Vitest, tsx, `@traffic-lens/shared` (workspace). No new external runtime dependencies.

**Inputs:** `data/koramangala.graph.json` (5121 edges, 2109 junctions — produced by Plan A) and a new hand-authored `data/koramangala.demand.json` (4 sources / 8 OD pairs).

---

## File Structure

### `packages/shared/src/` (additions)
- `sab-layout.ts` — SAB schema constants, `MAX_VEHICLES`, vehicle-state codes, `createSabViews(sab)`, `computeSabByteLength()`
- `demand.ts` — `Demand`, `DemandSource`, `DemandDestination` types
- `messages.ts` — discriminated unions for worker ↔ main protocol
- `index.ts` — updated barrel

### `packages/sim/src/` (new package)
- `prng.ts` — mulberry32 seeded PRNG
- `idm.ts` — `idmAcceleration()` pure function
- `mobil.ts` — `mobilDecision()` pure function
- `signals.ts` — per-junction phase machine
- `priority.ts` — `canEnterPriorityJunction()` gap-acceptance
- `routing.ts` — A* over the road-graph edges, OD-pair memoized
- `vehicle-store.ts` — SoA working arrays, free-list slot allocator, per-slot route storage
- `perception.ts` — per-edge spatial index, leader lookup
- `spawn.ts` — Poisson spawn controller per demand source
- `world.ts` — `World` class: owns all the above + sab views
- `tick.ts` — `tick(world: World): void` — the 9-step tick orchestrator
- `worker.ts` — Web Worker entry: message handlers + tick driver
- `index.ts` — public API barrel

### `packages/sim/tests/`
- `prng.test.ts`, `idm.test.ts`, `mobil.test.ts`, `signals.test.ts`, `priority.test.ts`, `routing.test.ts`, `vehicle-store.test.ts`, `perception.test.ts`, `spawn.test.ts`
- `tick.integration.test.ts` — 60-sim-second run on real Koramangala graph + tiny demand
- `determinism.test.ts` — 10,000-tick byte-compare run twice from same seed

### `data/`
- `koramangala.demand.json` — hand-authored, committed

---

## Task 1: Scaffold `packages/sim/`

**Files:**
- Create: `packages/sim/package.json`
- Create: `packages/sim/tsconfig.json`
- Create: `packages/sim/vitest.config.ts`
- Create: `packages/sim/src/index.ts`
- Create: `packages/sim/tests/.gitkeep`

- [ ] **Step 1: Create `packages/sim/package.json`**

```json
{
  "name": "@traffic-lens/sim",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest --run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@traffic-lens/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/sim/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Create `packages/sim/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create empty `packages/sim/src/index.ts`**

```ts
// Public API of @traffic-lens/sim — populated in later tasks.
export {};
```

- [ ] **Step 5: Install and verify**

Run: `pnpm install`
Expected: installs without error, adds `packages/sim` to workspace.

Run: `pnpm -F @traffic-lens/sim typecheck`
Expected: passes with no errors.

Run: `pnpm -F @traffic-lens/sim test`
Expected: vitest reports "No test files found" with exit code 1 — that is fine for now; do not commit yet.

- [ ] **Step 6: Commit**

```bash
git add packages/sim/package.json packages/sim/tsconfig.json packages/sim/vitest.config.ts packages/sim/src/index.ts pnpm-lock.yaml
git commit -m "Scaffold @traffic-lens/sim package"
```

---

## Task 2: SAB layout in `@traffic-lens/shared`

The SAB holds a small control region followed by per-vehicle struct-of-arrays for `MAX_VEHICLES = 2000` slots. Each field is its own typed-array view over a fixed slice of the SAB. We pad each field block out to 4-byte alignment so the next field's view is safe to create.

**Files:**
- Create: `packages/shared/src/sab-layout.ts`
- Create: `packages/shared/tests/sab-layout.test.ts`
- Modify: `packages/shared/src/index.ts` (add export)
- Modify: `packages/shared/package.json` (add vitest scripts + devDep)
- Create: `packages/shared/vitest.config.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/sab-layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  MAX_VEHICLES,
  STATE_FREE,
  STATE_ACTIVE,
  STATE_DESPAWNING,
  computeSabByteLength,
  createSabViews,
} from '../src/sab-layout.ts';

describe('sab-layout', () => {
  it('exposes the documented constants', () => {
    expect(MAX_VEHICLES).toBe(2000);
    expect(STATE_FREE).toBe(0);
    expect(STATE_ACTIVE).toBe(1);
    expect(STATE_DESPAWNING).toBe(2);
  });

  it('createSabViews produces views with the correct lengths', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const v = createSabViews(sab);
    expect(v.control.tickNumber.length).toBe(1);
    expect(v.control.simWallClockSec.length).toBe(1);
    expect(v.posX.length).toBe(MAX_VEHICLES);
    expect(v.posY.length).toBe(MAX_VEHICLES);
    expect(v.heading.length).toBe(MAX_VEHICLES);
    expect(v.speed.length).toBe(MAX_VEHICLES);
    expect(v.accel.length).toBe(MAX_VEHICLES);
    expect(v.edgeId.length).toBe(MAX_VEHICLES);
    expect(v.edgeProgress.length).toBe(MAX_VEHICLES);
    expect(v.lane.length).toBe(MAX_VEHICLES);
    expect(v.state.length).toBe(MAX_VEHICLES);
    expect(v.vehicleType.length).toBe(MAX_VEHICLES);
    expect(v.routeIdx.length).toBe(MAX_VEHICLES);
  });

  it('field views do not overlap in the SAB', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const v = createSabViews(sab);
    // Write a sentinel into every field's slot 0; reading each back must give
    // the value that field wrote, not whatever another field clobbered into it.
    v.posX[0] = 1;
    v.posY[0] = 2;
    v.heading[0] = 3;
    v.speed[0] = 4;
    v.accel[0] = 5;
    v.edgeId[0] = 6;
    v.edgeProgress[0] = 7;
    v.lane[0] = 8;
    v.state[0] = 9;
    v.vehicleType[0] = 10;
    v.routeIdx[0] = 11;
    expect(v.posX[0]).toBe(1);
    expect(v.posY[0]).toBe(2);
    expect(v.heading[0]).toBe(3);
    expect(v.speed[0]).toBe(4);
    expect(v.accel[0]).toBe(5);
    expect(v.edgeId[0]).toBe(6);
    expect(v.edgeProgress[0]).toBe(7);
    expect(v.lane[0]).toBe(8);
    expect(v.state[0]).toBe(9);
    expect(v.vehicleType[0]).toBe(10);
    expect(v.routeIdx[0]).toBe(11);
  });

  it('writing to the last slot of one field does not leak into the next', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const v = createSabViews(sab);
    v.posX[MAX_VEHICLES - 1] = 9999;
    expect(v.posY[0]).toBe(0);
    expect(v.posY[MAX_VEHICLES - 1]).toBe(0);
  });

  it('control region is at the start of the SAB and survives view round-trip', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const a = createSabViews(sab);
    a.control.tickNumber[0] = 12345;
    a.control.simWallClockSec[0] = 3.14159;
    const b = createSabViews(sab);
    expect(b.control.tickNumber[0]).toBe(12345);
    expect(b.control.simWallClockSec[0]).toBeCloseTo(3.14159);
  });
});
```

- [ ] **Step 2: Add vitest to shared package**

Modify `packages/shared/package.json` — add scripts and devDependency:

```json
{
  "name": "@traffic-lens/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest --run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

Create `packages/shared/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

Modify `packages/shared/tsconfig.json` — change include to also cover tests:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

Run: `pnpm install`
Expected: succeeds.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F @traffic-lens/shared test`
Expected: FAIL (`Cannot find module '../src/sab-layout.ts'`).

- [ ] **Step 4: Implement `sab-layout.ts`**

Create `packages/shared/src/sab-layout.ts`:

```ts
// SharedArrayBuffer layout shared by the sim worker (writer) and the main-thread
// renderer (reader). All per-vehicle arrays are struct-of-arrays. The control
// region is fixed-size at the start; per-vehicle field blocks follow, each
// padded out to 8-byte alignment so the next view is safe to construct.

export const MAX_VEHICLES = 2000;

// Vehicle slot lifecycle codes (Uint8 in SAB).
export const STATE_FREE = 0;
export const STATE_ACTIVE = 1;
export const STATE_DESPAWNING = 2;

// Vehicle type codes (Uint16 in SAB). Slice ships cars only.
export const VEHICLE_TYPE_CAR = 0;

// Internal: field byte sizes. Each field block is MAX_VEHICLES * elementSize,
// rounded up to 8 bytes so the following Float64-or-larger view is aligned.
const F32_SIZE = 4;
const U32_SIZE = 4;
const U16_SIZE = 2;
const U8_SIZE = 1;

function padTo8(n: number): number {
  return Math.ceil(n / 8) * 8;
}

// Control region layout. Always at byte offset 0.
//   Uint32  tickNumber           @ 0
//   Uint32  reserved             @ 4   (align Float64)
//   Float64 simWallClockSec      @ 8
//   Uint32  activeSnapshotIdx    @ 16  (reserved for future double-buffering)
//   Uint32  reserved             @ 20
//   8 bytes reserved             @ 24
const CONTROL_BYTES = 32;

// Per-vehicle field block byte sizes (each padded to 8B alignment).
const POS_X_BYTES        = padTo8(MAX_VEHICLES * F32_SIZE);
const POS_Y_BYTES        = padTo8(MAX_VEHICLES * F32_SIZE);
const HEADING_BYTES      = padTo8(MAX_VEHICLES * F32_SIZE);
const SPEED_BYTES        = padTo8(MAX_VEHICLES * F32_SIZE);
const ACCEL_BYTES        = padTo8(MAX_VEHICLES * F32_SIZE);
const EDGE_ID_BYTES      = padTo8(MAX_VEHICLES * U32_SIZE);
const EDGE_PROGRESS_BYTES = padTo8(MAX_VEHICLES * F32_SIZE);
const LANE_BYTES         = padTo8(MAX_VEHICLES * U8_SIZE);
const STATE_BYTES        = padTo8(MAX_VEHICLES * U8_SIZE);
const VEHICLE_TYPE_BYTES = padTo8(MAX_VEHICLES * U16_SIZE);
const ROUTE_IDX_BYTES    = padTo8(MAX_VEHICLES * U16_SIZE);

// Field offsets in the SAB.
const POS_X_OFFSET        = CONTROL_BYTES;
const POS_Y_OFFSET        = POS_X_OFFSET + POS_X_BYTES;
const HEADING_OFFSET      = POS_Y_OFFSET + POS_Y_BYTES;
const SPEED_OFFSET        = HEADING_OFFSET + HEADING_BYTES;
const ACCEL_OFFSET        = SPEED_OFFSET + SPEED_BYTES;
const EDGE_ID_OFFSET      = ACCEL_OFFSET + ACCEL_BYTES;
const EDGE_PROGRESS_OFFSET = EDGE_ID_OFFSET + EDGE_ID_BYTES;
const LANE_OFFSET         = EDGE_PROGRESS_OFFSET + EDGE_PROGRESS_BYTES;
const STATE_OFFSET        = LANE_OFFSET + LANE_BYTES;
const VEHICLE_TYPE_OFFSET = STATE_OFFSET + STATE_BYTES;
const ROUTE_IDX_OFFSET    = VEHICLE_TYPE_OFFSET + VEHICLE_TYPE_BYTES;
const TOTAL_BYTES         = ROUTE_IDX_OFFSET + ROUTE_IDX_BYTES;

export function computeSabByteLength(): number {
  return TOTAL_BYTES;
}

export interface SabControlViews {
  readonly tickNumber: Uint32Array;
  readonly simWallClockSec: Float64Array;
  readonly activeSnapshotIdx: Uint32Array;
}

export interface SabViews {
  readonly control: SabControlViews;
  readonly posX: Float32Array;
  readonly posY: Float32Array;
  readonly heading: Float32Array;
  readonly speed: Float32Array;
  readonly accel: Float32Array;
  readonly edgeId: Uint32Array;
  readonly edgeProgress: Float32Array;
  readonly lane: Uint8Array;
  readonly state: Uint8Array;
  readonly vehicleType: Uint16Array;
  readonly routeIdx: Uint16Array;
}

export function createSabViews(sab: SharedArrayBuffer): SabViews {
  return {
    control: {
      tickNumber: new Uint32Array(sab, 0, 1),
      simWallClockSec: new Float64Array(sab, 8, 1),
      activeSnapshotIdx: new Uint32Array(sab, 16, 1),
    },
    posX: new Float32Array(sab, POS_X_OFFSET, MAX_VEHICLES),
    posY: new Float32Array(sab, POS_Y_OFFSET, MAX_VEHICLES),
    heading: new Float32Array(sab, HEADING_OFFSET, MAX_VEHICLES),
    speed: new Float32Array(sab, SPEED_OFFSET, MAX_VEHICLES),
    accel: new Float32Array(sab, ACCEL_OFFSET, MAX_VEHICLES),
    edgeId: new Uint32Array(sab, EDGE_ID_OFFSET, MAX_VEHICLES),
    edgeProgress: new Float32Array(sab, EDGE_PROGRESS_OFFSET, MAX_VEHICLES),
    lane: new Uint8Array(sab, LANE_OFFSET, MAX_VEHICLES),
    state: new Uint8Array(sab, STATE_OFFSET, MAX_VEHICLES),
    vehicleType: new Uint16Array(sab, VEHICLE_TYPE_OFFSET, MAX_VEHICLES),
    routeIdx: new Uint16Array(sab, ROUTE_IDX_OFFSET, MAX_VEHICLES),
  };
}
```

- [ ] **Step 5: Update barrel export**

Modify `packages/shared/src/index.ts`:

```ts
export * from './road-graph.ts';
export * from './sab-layout.ts';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -F @traffic-lens/shared test`
Expected: all sab-layout tests pass.

Run: `pnpm -r typecheck`
Expected: all packages typecheck.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sab-layout.ts packages/shared/src/index.ts packages/shared/tests/sab-layout.test.ts packages/shared/package.json packages/shared/tsconfig.json packages/shared/vitest.config.ts pnpm-lock.yaml
git commit -m "Add SAB layout to shared"
```

---

## Task 3: Demand + worker-message types + hand-authored demand JSON

**Files:**
- Create: `packages/shared/src/demand.ts`
- Create: `packages/shared/src/messages.ts`
- Create: `packages/shared/tests/demand.test.ts`
- Create: `data/koramangala.demand.json`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/demand.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Demand } from '../src/demand.ts';
import { validateDemand } from '../src/demand.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMAND_PATH = resolve(HERE, '../../../data/koramangala.demand.json');
const GRAPH_PATH = resolve(HERE, '../../../data/koramangala.graph.json');

describe('demand', () => {
  it('koramangala.demand.json validates against the Demand shape', () => {
    const raw = JSON.parse(readFileSync(DEMAND_PATH, 'utf8')) as Demand;
    expect(() => validateDemand(raw)).not.toThrow();
    expect(raw.seed).toBeTypeOf('number');
    expect(raw.durationSec).toBeGreaterThan(0);
    expect(raw.sources.length).toBeGreaterThan(0);
  });

  it('every spawnEdgeId in the demand is a real boundary edge', () => {
    const demand = JSON.parse(readFileSync(DEMAND_PATH, 'utf8')) as Demand;
    const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8')) as {
      boundaryEdges: number[];
      edges: { id: number }[];
    };
    const boundarySet = new Set(graph.boundaryEdges);
    const edgeSet = new Set(graph.edges.map((e) => e.id));
    for (const src of demand.sources) {
      expect(boundarySet.has(src.spawnEdgeId)).toBe(true);
      for (const dest of src.destinations) {
        expect(boundarySet.has(dest.exitEdgeId)).toBe(true);
        expect(edgeSet.has(dest.exitEdgeId)).toBe(true);
      }
    }
  });

  it('validateDemand rejects empty sources', () => {
    expect(() =>
      validateDemand({ seed: 1, durationSec: 60, sources: [] }),
    ).toThrow(/at least one source/i);
  });

  it('validateDemand rejects zero-weight destination', () => {
    expect(() =>
      validateDemand({
        seed: 1,
        durationSec: 60,
        sources: [
          {
            id: 'x',
            spawnEdgeId: 1,
            vehiclesPerHour: 100,
            destinations: [{ exitEdgeId: 2, weight: 0 }],
          },
        ],
      }),
    ).toThrow(/weight/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @traffic-lens/shared test`
Expected: FAIL (`Cannot find module '../src/demand.ts'`).

- [ ] **Step 3: Implement `demand.ts`**

Create `packages/shared/src/demand.ts`:

```ts
import type { EdgeId } from './road-graph.ts';

export interface DemandDestination {
  readonly exitEdgeId: EdgeId;
  readonly weight: number;
}

export interface DemandSource {
  readonly id: string;
  readonly spawnEdgeId: EdgeId;
  readonly vehiclesPerHour: number;
  readonly destinations: readonly DemandDestination[];
}

export interface Demand {
  readonly seed: number;
  readonly durationSec: number;
  readonly sources: readonly DemandSource[];
}

export function validateDemand(d: Demand): void {
  const errors: string[] = [];
  if (!Number.isFinite(d.seed)) errors.push('seed must be a finite number');
  if (!(d.durationSec > 0)) errors.push('durationSec must be positive');
  if (d.sources.length === 0) errors.push('demand must have at least one source');
  const sourceIds = new Set<string>();
  for (const src of d.sources) {
    if (sourceIds.has(src.id)) errors.push(`duplicate source id "${src.id}"`);
    sourceIds.add(src.id);
    if (!(src.vehiclesPerHour > 0)) {
      errors.push(`source "${src.id}" vehiclesPerHour must be positive`);
    }
    if (src.destinations.length === 0) {
      errors.push(`source "${src.id}" must have at least one destination`);
    }
    for (const dest of src.destinations) {
      if (!(dest.weight > 0)) {
        errors.push(
          `source "${src.id}" destination ${dest.exitEdgeId} weight must be positive`,
        );
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Demand validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}
```

- [ ] **Step 4: Implement `messages.ts`**

Create `packages/shared/src/messages.ts`:

```ts
import type { RoadGraph } from './road-graph.ts';
import type { Demand } from './demand.ts';

// Messages sent from the main thread to the sim worker.
export type ToWorkerMessage =
  | InitMessage
  | PlayMessage
  | PauseMessage
  | StepMessage
  | SetSpeedMessage
  | ReseedMessage;

export interface InitMessage {
  readonly type: 'init';
  readonly graph: RoadGraph;
  readonly demand: Demand;
  readonly sab: SharedArrayBuffer;
}

export interface PlayMessage { readonly type: 'play'; }
export interface PauseMessage { readonly type: 'pause'; }
export interface StepMessage { readonly type: 'step'; }
export interface SetSpeedMessage {
  readonly type: 'setSpeed';
  readonly multiplier: number;
}
export interface ReseedMessage {
  readonly type: 'reseed';
  readonly seed: number;
}

// Messages from the worker to the main thread.
export type FromWorkerMessage = ReadyMessage | ErrorMessage;

export interface ReadyMessage { readonly type: 'ready'; }
export interface ErrorMessage {
  readonly type: 'error';
  readonly message: string;
  readonly tick: number;
}
```

- [ ] **Step 5: Hand-author `data/koramangala.demand.json`**

This step requires picking 4 real `boundaryEdges` from the existing graph file. The implementer must:

1. Read `data/koramangala.graph.json` (it is committed)
2. Pick 4 distinct boundary edges as sources, ideally spread across N/S/E/W
3. For each source, pick 2 different boundary edges (not the source itself) as destinations
4. Write the file. **Use the exact numeric edge IDs from the graph, not made-up ones.**

Run this helper to pick valid IDs (one-shot, in the repo root):

```bash
node -e '
const fs = require("fs");
const g = JSON.parse(fs.readFileSync("data/koramangala.graph.json", "utf8"));
const edgesById = new Map(g.edges.map(e => [e.id, e]));
const boundary = g.boundaryEdges.map(id => ({ id, e: edgesById.get(id) }));
// Sort by midpoint y (south to north) then x (west to east); print 12 spread samples.
boundary.sort((a, b) => a.e.geometry[0].y - b.e.geometry[0].y);
const sample = (n) => {
  const step = Math.floor(boundary.length / n);
  return Array.from({length: n}, (_, i) => boundary[i*step]);
};
console.log(JSON.stringify(sample(12).map(b => ({
  id: b.id, x: Math.round(b.e.geometry[0].x), y: Math.round(b.e.geometry[0].y),
  roadClass: b.e.roadClass,
})), null, 2));
'
```

From that output, pick 4 IDs to use as sources (call them S1..S4) and 4 different IDs to use as destinations (call them D1..D4). Write the file. Example shape (fill in real numbers):

```json
{
  "seed": 42,
  "durationSec": 600,
  "sources": [
    {
      "id": "south_in",
      "spawnEdgeId": 0,
      "vehiclesPerHour": 600,
      "destinations": [
        { "exitEdgeId": 0, "weight": 0.6 },
        { "exitEdgeId": 0, "weight": 0.4 }
      ]
    }
  ]
}
```

Use 4 sources, each with 2 destinations. Total = 8 OD pairs. Vehicles-per-hour per source: 400–800 (slice target is "300–500 cars visible at once" — these rates roughly produce that population with ~30-second average traversal).

Replace each `0` placeholder with the actual edge IDs you chose. Spawn edge ≠ any of its destinations.

- [ ] **Step 6: Update barrel export**

Modify `packages/shared/src/index.ts`:

```ts
export * from './road-graph.ts';
export * from './sab-layout.ts';
export * from './demand.ts';
export * from './messages.ts';
```

- [ ] **Step 7: Run tests**

Run: `pnpm -F @traffic-lens/shared test`
Expected: all demand tests pass — including the "every spawnEdgeId is a real boundary edge" test, which is the load-bearing check that the demand JSON references real edges.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/demand.ts packages/shared/src/messages.ts packages/shared/src/index.ts packages/shared/tests/demand.test.ts data/koramangala.demand.json
git commit -m "Add demand schema, worker message types, and Koramangala demand JSON"
```

---

## Task 4: PRNG (mulberry32)

**Files:**
- Create: `packages/sim/src/prng.ts`
- Create: `packages/sim/tests/prng.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sim/tests/prng.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @traffic-lens/sim test`
Expected: FAIL (`Cannot find module '../src/prng.ts'`).

- [ ] **Step 3: Implement `prng.ts`**

Create `packages/sim/src/prng.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @traffic-lens/sim test`
Expected: all 4 prng tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/prng.ts packages/sim/tests/prng.test.ts
git commit -m "Add mulberry32 PRNG"
```

---

## Task 5: IDM acceleration

The Intelligent Driver Model gives a vehicle's acceleration as a function of its own speed, the leader's speed, the gap, and a few parameters. We use the Treiber paper defaults for the "average" driver profile:
- `v0` (desired speed) — supplied by the caller per-edge (road-class speed)
- `T` (safe time headway) = 1.5 s
- `s0` (jam distance) = 2 m
- `a` (max accel) = 1.5 m/s²
- `b` (comfort decel) = 2.0 m/s²

When there is no leader, `gap = Infinity` and the model reduces to free-flow accel.

**Files:**
- Create: `packages/sim/src/idm.ts`
- Create: `packages/sim/tests/idm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sim/tests/idm.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @traffic-lens/sim test`
Expected: FAIL on idm tests (module not found).

- [ ] **Step 3: Implement `idm.ts`**

Create `packages/sim/src/idm.ts`:

```ts
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
  const sStar = s0 + Math.max(0, speed * T + (speed * dv) / (2 * Math.sqrt(a * b)));
  const interactionTerm = Math.pow(sStar / Math.max(gap, 0.001), 2);
  return a * (1 - freeTerm - interactionTerm);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @traffic-lens/sim test`
Expected: all idm tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/idm.ts packages/sim/tests/idm.test.ts
git commit -m "Add IDM car-following acceleration model"
```

---

## Task 6: MOBIL lane-change decision

MOBIL evaluates a discretionary lane change by computing the IDM acceleration for the vehicle and its surrounding neighbors in both the current and prospective configurations, and accepting iff:
1. **Safety:** the prospective new-lane follower's acceleration doesn't drop below `-bSafe`.
2. **Incentive:** total accel gain > `threshold` (own gain + politeness · sum of others' gain).

For the slice we model only discretionary changes (free choice) and "must-change-for-route" mandatory changes; the latter use a strong incentive bias from the caller (`mandatoryBias`).

**Files:**
- Create: `packages/sim/src/mobil.ts`
- Create: `packages/sim/tests/mobil.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sim/tests/mobil.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @traffic-lens/sim test`
Expected: FAIL on mobil tests (module not found).

- [ ] **Step 3: Implement `mobil.ts`**

Create `packages/sim/src/mobil.ts`:

```ts
import { idmAcceleration, type IdmParams } from './idm.ts';

export interface MobilParams {
  readonly politeness: number;        // p — weight on others' accel change
  readonly threshold: number;         // Δa_th — incentive threshold (m/s²)
  readonly bSafe: number;             // max tolerable braking for new follower (m/s²)
}

export const DEFAULT_MOBIL_PARAMS: MobilParams = {
  politeness: 0.3,
  threshold: 0.2,
  bSafe: 4.0,
};

interface Neighbor {
  readonly speed: number;
  readonly gap: number;
}

interface FollowerNeighbor extends Neighbor {
  readonly v0: number;
}

export interface MobilInput {
  readonly self: {
    readonly speed: number;
    readonly v0: number;
  };
  readonly currentLeader: Neighbor;
  readonly newLaneLeader: Neighbor;
  readonly newLaneFollower: FollowerNeighbor;
  readonly oldLaneFollower: FollowerNeighbor;
  // Strong positive bias added to the incentive term for must-change-for-route
  // scenarios. 0 for discretionary changes.
  readonly mandatoryBias: number;
  readonly idm: IdmParams;
  readonly mobil: MobilParams;
}

export function mobilDecision(input: MobilInput): boolean {
  const { self, currentLeader, newLaneLeader, newLaneFollower, oldLaneFollower,
          mandatoryBias, idm, mobil } = input;

  const aSelfCur = idmAcceleration({
    speed: self.speed, leaderSpeed: currentLeader.speed,
    gap: currentLeader.gap, v0: self.v0, params: idm,
  });
  const aSelfNew = idmAcceleration({
    speed: self.speed, leaderSpeed: newLaneLeader.speed,
    gap: newLaneLeader.gap, v0: self.v0, params: idm,
  });

  // New follower's accel — gap from new follower's perspective shrinks to `self`.
  const aNewFolBefore = idmAcceleration({
    speed: newLaneFollower.speed, leaderSpeed: newLaneLeader.speed,
    gap: newLaneFollower.gap + newLaneLeader.gap, v0: newLaneFollower.v0, params: idm,
  });
  const aNewFolAfter = idmAcceleration({
    speed: newLaneFollower.speed, leaderSpeed: self.speed,
    gap: newLaneFollower.gap, v0: newLaneFollower.v0, params: idm,
  });

  // Safety: new follower must not brake worse than -bSafe.
  if (aNewFolAfter < -mobil.bSafe) return false;

  // Old follower will see a relaxed leader once self moves out.
  const aOldFolBefore = idmAcceleration({
    speed: oldLaneFollower.speed, leaderSpeed: self.speed,
    gap: oldLaneFollower.gap, v0: oldLaneFollower.v0, params: idm,
  });
  const aOldFolAfter = idmAcceleration({
    speed: oldLaneFollower.speed, leaderSpeed: currentLeader.speed,
    gap: oldLaneFollower.gap + currentLeader.gap, v0: oldLaneFollower.v0, params: idm,
  });

  const ownGain = aSelfNew - aSelfCur;
  const othersGain = (aNewFolAfter - aNewFolBefore) + (aOldFolAfter - aOldFolBefore);
  const incentive = ownGain + mobil.politeness * othersGain + mandatoryBias;
  return incentive > mobil.threshold;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @traffic-lens/sim test`
Expected: all mobil tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/mobil.ts packages/sim/tests/mobil.test.ts
git commit -m "Add MOBIL lane-change decision model"
```

---

## Task 7: Signal phase state machine

Each signalled junction owns a `SignalState` that tracks the current phase index and the elapsed seconds within the phase. Each tick advances the elapsed time; when it reaches the phase duration, the phase index increments (wrapping around). A helper queries whether a specific incoming edge has green right now.

**Files:**
- Create: `packages/sim/src/signals.ts`
- Create: `packages/sim/tests/signals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sim/tests/signals.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @traffic-lens/sim test`
Expected: FAIL on signals tests.

- [ ] **Step 3: Implement `signals.ts`**

Create `packages/sim/src/signals.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @traffic-lens/sim test`
Expected: all signal tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/signals.ts packages/sim/tests/signals.test.ts
git commit -m "Add signal phase state machine"
```

---

## Task 8: Priority-junction gap acceptance

A vehicle on a yield edge approaching the junction needs to decide whether it can enter. We project all approaching priority-edge vehicles within a sight distance onto a time-to-junction axis, and accept iff our own time-to-junction plus a safety margin is less than the minimum priority-vehicle time-to-junction.

For vehicles still on the yield approach itself, "time to junction" = `distanceToJunction / max(speed, ε)`. For stopped priority vehicles, time-to-junction is large; the function should accept.

**Files:**
- Create: `packages/sim/src/priority.ts`
- Create: `packages/sim/tests/priority.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sim/tests/priority.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @traffic-lens/sim test`
Expected: FAIL on priority tests.

- [ ] **Step 3: Implement `priority.ts`**

Create `packages/sim/src/priority.ts`:

```ts
export interface PriorityApproach {
  readonly distanceToJunction: number; // m, positive — still approaching
  readonly speed: number;              // m/s, positive
}

export interface PriorityParams {
  readonly safetyMarginSec: number;     // we need at least this much head start
  readonly minSightDistanceM: number;   // ignore priority vehicles farther than this
  readonly minPrioritySpeedMps: number; // treat slower-than-this priority vehicles as no conflict
  readonly minSelfSpeedMps: number;     // refuse decision when own speed below this
}

export const DEFAULT_PRIORITY_PARAMS: PriorityParams = {
  safetyMarginSec: 2.0,
  minSightDistanceM: 80,
  minPrioritySpeedMps: 0.5,
  minSelfSpeedMps: 0.5,
};

export interface PriorityInput {
  readonly selfDistanceToJunction: number;
  readonly selfSpeed: number;
  readonly priorityApproaches: readonly PriorityApproach[];
  readonly params: PriorityParams;
}

export function canEnterPriorityJunction(input: PriorityInput): boolean {
  const { selfDistanceToJunction, selfSpeed, priorityApproaches, params } = input;
  if (selfSpeed < params.minSelfSpeedMps) return false;

  const tSelf = selfDistanceToJunction / selfSpeed;
  for (const other of priorityApproaches) {
    if (other.distanceToJunction > params.minSightDistanceM) continue;
    if (other.speed < params.minPrioritySpeedMps) continue;
    const tOther = other.distanceToJunction / other.speed;
    if (tSelf + params.safetyMarginSec >= tOther) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @traffic-lens/sim test`
Expected: all priority tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/priority.ts packages/sim/tests/priority.test.ts
git commit -m "Add priority-junction gap-acceptance"
```

---

## Task 9: A\* routing over the road graph

We A\* over directed edges. State = "I'm currently traversing edge E". Successors = "I can next traverse edge E' iff E.toJunction === E'.fromJunction". Cost of leaving edge E = `E.lengthM / ROAD_CLASS_SPEED_MPS[E.roadClass]`. Heuristic from E to goal G = Euclidean(E.geometry-last, G.geometry-first) / max-class-speed (admissible).

We memoize per (spawnEdgeId, exitEdgeId) since the slice has only ~8 OD pairs.

**Files:**
- Create: `packages/sim/src/routing.ts`
- Create: `packages/sim/tests/routing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sim/tests/routing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Edge, Junction, RoadGraph } from '@traffic-lens/shared';
import { Router } from '../src/routing.ts';

function edge(id: number, from: number, to: number, lengthM: number, geom: [number,number][]): Edge {
  return {
    id, fromJunction: from, toJunction: to,
    geometry: geom.map(([x,y]) => ({ x, y })),
    lengthM, lanes: 1, roadClass: 'residential', oneway: true,
  };
}

function pj(id: number, x: number, y: number): Junction {
  return {
    id, kind: 'priority', lon: 0, lat: 0, position: { x, y },
    incomingEdges: [], outgoingEdges: [], connections: [], priorityEdges: [],
  };
}

const META = {
  bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
  projection: 'webMercator' as const,
  generatedAt: '', sourceHash: '', scriptVersion: '',
};

describe('Router', () => {
  // Linear graph: 1 → 2 → 3 → 4 over edges 10, 20, 30.
  const linear: RoadGraph = {
    meta: META,
    edges: [
      edge(10, 1, 2, 100, [[0,0],[100,0]]),
      edge(20, 2, 3, 100, [[100,0],[200,0]]),
      edge(30, 3, 4, 100, [[200,0],[300,0]]),
    ],
    junctions: [pj(1,0,0), pj(2,100,0), pj(3,200,0), pj(4,300,0)],
    boundaryEdges: [10, 30],
  };

  it('finds a single-edge route when spawn equals exit', () => {
    const r = new Router(linear);
    expect(r.findRoute(10, 10)).toEqual([10]);
  });

  it('finds the direct linear route', () => {
    const r = new Router(linear);
    expect(r.findRoute(10, 30)).toEqual([10, 20, 30]);
  });

  it('returns null when no path exists', () => {
    const disconnected: RoadGraph = {
      ...linear,
      edges: [
        edge(10, 1, 2, 100, [[0,0],[100,0]]),
        edge(99, 3, 4, 100, [[500,0],[600,0]]),
      ],
      junctions: [pj(1,0,0), pj(2,100,0), pj(3,500,0), pj(4,600,0)],
    };
    const r = new Router(disconnected);
    expect(r.findRoute(10, 99)).toBeNull();
  });

  it('prefers the shorter of two paths', () => {
    // Diamond: 1 → 2 (short, edge 10), 1 → 3 (long, edge 11), both converge at 4.
    const diamond: RoadGraph = {
      meta: META,
      edges: [
        edge(10, 1, 2,  50, [[0,0],[50,0]]),
        edge(11, 1, 3, 500, [[0,0],[0,500]]),
        edge(20, 2, 4, 100, [[50,0],[150,0]]),
        edge(21, 3, 4, 100, [[0,500],[150,500]]),
        edge(30, 4, 5, 50,  [[150,0],[200,0]]),
      ],
      junctions: [pj(1,0,0), pj(2,50,0), pj(3,0,500), pj(4,150,0), pj(5,200,0)],
      boundaryEdges: [10, 30],
    };
    const r = new Router(diamond);
    expect(r.findRoute(10, 30)).toEqual([10, 20, 30]);
  });

  it('caches results: a second findRoute returns the same array instance', () => {
    const r = new Router(linear);
    const a = r.findRoute(10, 30);
    const b = r.findRoute(10, 30);
    expect(b).toBe(a);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @traffic-lens/sim test`
Expected: FAIL on routing tests.

- [ ] **Step 3: Implement `routing.ts`**

Create `packages/sim/src/routing.ts`:

```ts
import type { Edge, EdgeId, JunctionId, RoadGraph } from '@traffic-lens/shared';
import { ROAD_CLASS_SPEED_MPS } from '@traffic-lens/shared';

const MAX_SPEED_MPS = Math.max(...Object.values(ROAD_CLASS_SPEED_MPS));

interface OpenEntry {
  edgeId: EdgeId;
  gCost: number;
  fCost: number;
}

export class Router {
  private readonly edgeById = new Map<EdgeId, Edge>();
  private readonly outgoingByJunction = new Map<JunctionId, EdgeId[]>();
  private readonly cache = new Map<string, EdgeId[] | null>();

  constructor(graph: RoadGraph) {
    for (const e of graph.edges) {
      this.edgeById.set(e.id, e);
      const list = this.outgoingByJunction.get(e.fromJunction);
      if (list) list.push(e.id);
      else this.outgoingByJunction.set(e.fromJunction, [e.id]);
    }
  }

  findRoute(spawnEdgeId: EdgeId, exitEdgeId: EdgeId): EdgeId[] | null {
    const key = `${spawnEdgeId}->${exitEdgeId}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const result = this.aStar(spawnEdgeId, exitEdgeId);
    this.cache.set(key, result);
    return result;
  }

  private aStar(spawnEdgeId: EdgeId, exitEdgeId: EdgeId): EdgeId[] | null {
    const start = this.edgeById.get(spawnEdgeId);
    const goal = this.edgeById.get(exitEdgeId);
    if (!start || !goal) return null;
    if (spawnEdgeId === exitEdgeId) return [spawnEdgeId];

    const cameFrom = new Map<EdgeId, EdgeId>();
    const gScore = new Map<EdgeId, number>();
    gScore.set(spawnEdgeId, 0);

    // Open list as a min-heap-by-fCost would be ideal; for ≤5121 edges a plain
    // array + linear scan is acceptable. We can swap in a heap later if profiling shows need.
    const open: OpenEntry[] = [{
      edgeId: spawnEdgeId,
      gCost: 0,
      fCost: this.heuristic(start, goal),
    }];
    const inOpen = new Set<EdgeId>([spawnEdgeId]);
    const closed = new Set<EdgeId>();

    while (open.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i]!.fCost < open[bestIdx]!.fCost) bestIdx = i;
      }
      const current = open.splice(bestIdx, 1)[0]!;
      inOpen.delete(current.edgeId);
      if (current.edgeId === exitEdgeId) {
        return reconstructPath(cameFrom, exitEdgeId);
      }
      closed.add(current.edgeId);

      const currentEdge = this.edgeById.get(current.edgeId)!;
      const successors = this.outgoingByJunction.get(currentEdge.toJunction) ?? [];
      const stepCost = currentEdge.lengthM / ROAD_CLASS_SPEED_MPS[currentEdge.roadClass];
      for (const nextId of successors) {
        if (closed.has(nextId)) continue;
        const tentativeG = current.gCost + stepCost;
        const prevG = gScore.get(nextId) ?? Infinity;
        if (tentativeG >= prevG) continue;
        cameFrom.set(nextId, current.edgeId);
        gScore.set(nextId, tentativeG);
        const nextEdge = this.edgeById.get(nextId)!;
        const fCost = tentativeG + this.heuristic(nextEdge, goal);
        if (inOpen.has(nextId)) {
          for (const entry of open) {
            if (entry.edgeId === nextId) {
              entry.gCost = tentativeG;
              entry.fCost = fCost;
              break;
            }
          }
        } else {
          open.push({ edgeId: nextId, gCost: tentativeG, fCost });
          inOpen.add(nextId);
        }
      }
    }
    return null;
  }

  private heuristic(from: Edge, goal: Edge): number {
    const a = from.geometry[from.geometry.length - 1]!;
    const b = goal.geometry[0]!;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy) / MAX_SPEED_MPS;
  }
}

function reconstructPath(cameFrom: Map<EdgeId, EdgeId>, goal: EdgeId): EdgeId[] {
  const path: EdgeId[] = [goal];
  let cur: EdgeId | undefined = goal;
  while (cur !== undefined && cameFrom.has(cur)) {
    cur = cameFrom.get(cur);
    if (cur !== undefined) path.push(cur);
  }
  return path.reverse();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @traffic-lens/sim test`
Expected: all routing tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/routing.ts packages/sim/tests/routing.test.ts
git commit -m "Add A* router over the road graph"
```

---

## Task 10: Vehicle store

The vehicle store owns:
- The SAB views (the canonical render-facing state)
- A free-list of slot indices for O(1) spawn/despawn
- A `Map<slotIdx, Uint32Array>` of routes (variable-length, worker-only)

It exposes `spawn(initialState)`, `despawn(slotIdx)`, and an iteration helper.

**Files:**
- Create: `packages/sim/src/vehicle-store.ts`
- Create: `packages/sim/tests/vehicle-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sim/tests/vehicle-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeSabByteLength,
  createSabViews,
  MAX_VEHICLES,
  STATE_ACTIVE,
  STATE_FREE,
  VEHICLE_TYPE_CAR,
} from '@traffic-lens/shared';
import { VehicleStore } from '../src/vehicle-store.ts';

function makeStore() {
  const sab = new SharedArrayBuffer(computeSabByteLength());
  const views = createSabViews(sab);
  return new VehicleStore(views);
}

const SPAWN = {
  posX: 1, posY: 2, heading: 0, speed: 5, accel: 0,
  edgeId: 100, edgeProgress: 0, lane: 0,
  vehicleType: VEHICLE_TYPE_CAR,
  route: new Uint32Array([100, 200, 300]),
};

describe('VehicleStore', () => {
  it('spawn allocates a free slot and marks it active', () => {
    const s = makeStore();
    const idx = s.spawn(SPAWN);
    expect(idx).toBe(0);
    expect(s.views.state[idx]).toBe(STATE_ACTIVE);
    expect(s.views.posX[idx]).toBe(1);
    expect(s.views.edgeId[idx]).toBe(100);
    expect(s.views.lane[idx]).toBe(0);
    expect(s.getRoute(idx)).toEqual(new Uint32Array([100, 200, 300]));
  });

  it('spawn allocates consecutive slots when no despawns yet', () => {
    const s = makeStore();
    const a = s.spawn(SPAWN);
    const b = s.spawn(SPAWN);
    const c = s.spawn(SPAWN);
    expect([a, b, c]).toEqual([0, 1, 2]);
  });

  it('despawn returns slot to free list and reuses it next spawn', () => {
    const s = makeStore();
    const a = s.spawn(SPAWN);
    const b = s.spawn(SPAWN);
    s.despawn(a);
    expect(s.views.state[a]).toBe(STATE_FREE);
    expect(s.getRoute(a)).toBeUndefined();
    const c = s.spawn(SPAWN);
    expect(c).toBe(a);
    expect(s.views.state[b]).toBe(STATE_ACTIVE);
  });

  it('throws when MAX_VEHICLES slots are exhausted', () => {
    const s = makeStore();
    for (let i = 0; i < MAX_VEHICLES; i++) s.spawn(SPAWN);
    expect(() => s.spawn(SPAWN)).toThrow(/MAX_VEHICLES/);
  });

  it('forEachActive iterates only active slots', () => {
    const s = makeStore();
    const a = s.spawn(SPAWN);
    const b = s.spawn(SPAWN);
    const c = s.spawn(SPAWN);
    s.despawn(b);
    const seen: number[] = [];
    s.forEachActive((idx) => seen.push(idx));
    expect(seen.sort()).toEqual([a, c]);
  });

  it('activeCount tracks live vehicles', () => {
    const s = makeStore();
    expect(s.activeCount()).toBe(0);
    s.spawn(SPAWN);
    s.spawn(SPAWN);
    expect(s.activeCount()).toBe(2);
    const x = s.spawn(SPAWN);
    s.despawn(x);
    expect(s.activeCount()).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @traffic-lens/sim test`
Expected: FAIL on vehicle-store tests.

- [ ] **Step 3: Implement `vehicle-store.ts`**

Create `packages/sim/src/vehicle-store.ts`:

```ts
import type { EdgeId } from '@traffic-lens/shared';
import {
  MAX_VEHICLES,
  STATE_ACTIVE,
  STATE_FREE,
  type SabViews,
} from '@traffic-lens/shared';

export interface SpawnInit {
  readonly posX: number;
  readonly posY: number;
  readonly heading: number;
  readonly speed: number;
  readonly accel: number;
  readonly edgeId: EdgeId;
  readonly edgeProgress: number;
  readonly lane: number;
  readonly vehicleType: number;
  readonly route: Uint32Array;
}

export class VehicleStore {
  readonly views: SabViews;
  private readonly freeList: number[];
  private readonly routes = new Map<number, Uint32Array>();
  private active = 0;

  constructor(views: SabViews) {
    this.views = views;
    this.freeList = Array.from({ length: MAX_VEHICLES }, (_, i) => MAX_VEHICLES - 1 - i);
    // State buffer is zero-initialized by SAB; that means every slot is STATE_FREE.
  }

  spawn(init: SpawnInit): number {
    const idx = this.freeList.pop();
    if (idx === undefined) {
      throw new Error(`VehicleStore: no free slot, MAX_VEHICLES=${MAX_VEHICLES} reached`);
    }
    const v = this.views;
    v.posX[idx] = init.posX;
    v.posY[idx] = init.posY;
    v.heading[idx] = init.heading;
    v.speed[idx] = init.speed;
    v.accel[idx] = init.accel;
    v.edgeId[idx] = init.edgeId;
    v.edgeProgress[idx] = init.edgeProgress;
    v.lane[idx] = init.lane;
    v.state[idx] = STATE_ACTIVE;
    v.vehicleType[idx] = init.vehicleType;
    v.routeIdx[idx] = 0;
    this.routes.set(idx, init.route);
    this.active++;
    return idx;
  }

  despawn(idx: number): void {
    const v = this.views;
    if (v.state[idx] === STATE_FREE) return;
    v.state[idx] = STATE_FREE;
    v.posX[idx] = 0;
    v.posY[idx] = 0;
    v.heading[idx] = 0;
    v.speed[idx] = 0;
    v.accel[idx] = 0;
    v.edgeId[idx] = 0;
    v.edgeProgress[idx] = 0;
    v.lane[idx] = 0;
    v.vehicleType[idx] = 0;
    v.routeIdx[idx] = 0;
    this.routes.delete(idx);
    this.freeList.push(idx);
    this.active--;
  }

  getRoute(idx: number): Uint32Array | undefined {
    return this.routes.get(idx);
  }

  forEachActive(cb: (idx: number) => void): void {
    const state = this.views.state;
    for (let i = 0; i < MAX_VEHICLES; i++) {
      if (state[i] === STATE_ACTIVE) cb(i);
    }
  }

  activeCount(): number {
    return this.active;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @traffic-lens/sim test`
Expected: all vehicle-store tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/vehicle-store.ts packages/sim/tests/vehicle-store.test.ts
git commit -m "Add vehicle slot store with free-list and route map"
```

---

## Task 11: Perception (per-edge spatial index, leader lookup)

Each tick we rebuild a per-edge sorted list of `{ slotIdx, edgeProgress, lane }` and use binary search to find the leader in front of a given vehicle. "Leader" = same edge, same lane, larger progress, smallest progress-difference.

We use a single object: a `Map<edgeId, EdgeIndex>`, where `EdgeIndex` is two parallel typed arrays (slotIdx, progress) sorted by progress. We allocate them once, sized to `MAX_VEHICLES`, and reuse — no per-tick allocations.

**Files:**
- Create: `packages/sim/src/perception.ts`
- Create: `packages/sim/tests/perception.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sim/tests/perception.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeSabByteLength,
  createSabViews,
  VEHICLE_TYPE_CAR,
} from '@traffic-lens/shared';
import type { Edge } from '@traffic-lens/shared';
import { VehicleStore } from '../src/vehicle-store.ts';
import { PerceptionIndex } from '../src/perception.ts';

function edge(id: number, lanes: number, lengthM: number): Edge {
  return {
    id, fromJunction: 1, toJunction: 2,
    geometry: [{ x: 0, y: 0 }, { x: lengthM, y: 0 }],
    lengthM, lanes, roadClass: 'residential', oneway: true,
  };
}

function makeStore() {
  const sab = new SharedArrayBuffer(computeSabByteLength());
  return new VehicleStore(createSabViews(sab));
}

function spawn(store: VehicleStore, edgeId: number, lane: number, edgeProgress: number) {
  return store.spawn({
    posX: 0, posY: 0, heading: 0, speed: 5, accel: 0,
    edgeId, edgeProgress, lane,
    vehicleType: VEHICLE_TYPE_CAR,
    route: new Uint32Array([edgeId]),
  });
}

describe('PerceptionIndex', () => {
  it('finds the immediate leader on the same lane', () => {
    const store = makeStore();
    const e = edge(7, 2, 100);
    const a = spawn(store, 7, 0, 0.2);
    const b = spawn(store, 7, 0, 0.5);
    spawn(store, 7, 1, 0.4); // different lane, not a leader

    const idx = new PerceptionIndex();
    idx.rebuild(store, new Map([[7, e]]));

    const leader = idx.findLeader(7, 0, 0.2);
    expect(leader).not.toBeNull();
    expect(leader!.slotIdx).toBe(b);
    // Gap = (0.5 - 0.2) * 100 = 30 m.
    expect(leader!.gapM).toBeCloseTo(30, 5);
    expect(idx.findLeader(7, 0, 0.5)).toBeNull();
  });

  it('returns null when no vehicles share the edge', () => {
    const store = makeStore();
    const e = edge(7, 1, 100);
    spawn(store, 99, 0, 0.5); // different edge
    const idx = new PerceptionIndex();
    idx.rebuild(store, new Map([[7, e], [99, edge(99, 1, 100)]]));
    expect(idx.findLeader(7, 0, 0.0)).toBeNull();
  });

  it('handles many vehicles on one edge and finds nearest in front', () => {
    const store = makeStore();
    const e = edge(7, 1, 100);
    const slots: number[] = [];
    for (let i = 0; i < 10; i++) slots.push(spawn(store, 7, 0, i / 10));
    const idx = new PerceptionIndex();
    idx.rebuild(store, new Map([[7, e]]));
    const leader = idx.findLeader(7, 0, 0.45);
    expect(leader!.slotIdx).toBe(slots[5]);
    expect(leader!.gapM).toBeCloseTo(5, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @traffic-lens/sim test`
Expected: FAIL on perception tests.

- [ ] **Step 3: Implement `perception.ts`**

Create `packages/sim/src/perception.ts`:

```ts
import type { Edge, EdgeId } from '@traffic-lens/shared';
import type { VehicleStore } from './vehicle-store.ts';

interface EdgeBucket {
  slotIdx: number[];      // parallel arrays sorted by progress ascending
  progress: number[];
  lane: number[];
}

export interface LeaderResult {
  slotIdx: number;
  gapM: number;
}

export class PerceptionIndex {
  private buckets = new Map<EdgeId, EdgeBucket>();

  rebuild(store: VehicleStore, edges: ReadonlyMap<EdgeId, Edge>): void {
    // Reset (preserving allocation for hot reuse).
    for (const bucket of this.buckets.values()) {
      bucket.slotIdx.length = 0;
      bucket.progress.length = 0;
      bucket.lane.length = 0;
    }
    const v = store.views;
    store.forEachActive((idx) => {
      const eid = v.edgeId[idx]!;
      let bucket = this.buckets.get(eid);
      if (!bucket) {
        bucket = { slotIdx: [], progress: [], lane: [] };
        this.buckets.set(eid, bucket);
      }
      bucket.slotIdx.push(idx);
      bucket.progress.push(v.edgeProgress[idx]!);
      bucket.lane.push(v.lane[idx]!);
    });
    // Sort each bucket by progress ascending. We need a co-sort across the
    // three parallel arrays, so build index permutation then apply it.
    for (const [eid, bucket] of this.buckets) {
      if (bucket.slotIdx.length < 2) continue;
      const perm = bucket.slotIdx.map((_, i) => i);
      perm.sort((a, b) => bucket.progress[a]! - bucket.progress[b]!);
      const newSlot = perm.map((i) => bucket.slotIdx[i]!);
      const newProg = perm.map((i) => bucket.progress[i]!);
      const newLane = perm.map((i) => bucket.lane[i]!);
      bucket.slotIdx = newSlot;
      bucket.progress = newProg;
      bucket.lane = newLane;
      // edges param used to short-circuit if we ever need length here, but
      // the gap conversion happens in findLeader via the same edges map.
      void edges.get(eid);
    }
    this.edgesRef = edges;
  }

  private edgesRef: ReadonlyMap<EdgeId, Edge> = new Map();

  findLeader(edgeId: EdgeId, lane: number, progress: number): LeaderResult | null {
    const bucket = this.buckets.get(edgeId);
    const edge = this.edgesRef.get(edgeId);
    if (!bucket || !edge) return null;
    // Linear scan from first entry with progress > self.progress (binary search
    // would be an optimization but with <50 vehicles per edge the constants
    // dominate; revisit only if profiling demands it).
    let bestIdx = -1;
    let bestProg = Infinity;
    for (let i = 0; i < bucket.slotIdx.length; i++) {
      const p = bucket.progress[i]!;
      if (p <= progress) continue;
      if (bucket.lane[i] !== lane) continue;
      if (p < bestProg) {
        bestProg = p;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return null;
    return {
      slotIdx: bucket.slotIdx[bestIdx]!,
      gapM: (bestProg - progress) * edge.lengthM,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @traffic-lens/sim test`
Expected: all perception tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/perception.ts packages/sim/tests/perception.test.ts
git commit -m "Add per-edge perception index and leader lookup"
```

---

## Task 12: Spawning

Per-source Poisson sampling. Each tick, each source draws `rng() < (rate * dt)`; if true, attempt a spawn:
- Pick destination via weighted random
- Get cached route from Router
- If route is null, skip
- Check spawn-lane occupancy: if any active vehicle on `spawnEdgeId, lane = 0` has progress < `10m / edgeLength`, hold (do not spawn this tick)
- Allocate a slot

Returns the list of slot indices spawned this tick.

**Files:**
- Create: `packages/sim/src/spawn.ts`
- Create: `packages/sim/tests/spawn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sim/tests/spawn.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeSabByteLength,
  createSabViews,
  ROAD_CLASS_SPEED_MPS,
  VEHICLE_TYPE_CAR,
} from '@traffic-lens/shared';
import type { Demand, Edge, RoadGraph } from '@traffic-lens/shared';
import { VehicleStore } from '../src/vehicle-store.ts';
import { Router } from '../src/routing.ts';
import { SpawnController } from '../src/spawn.ts';

function edge(id: number, from: number, to: number, lengthM: number): Edge {
  return {
    id, fromJunction: from, toJunction: to,
    geometry: [{ x: from, y: 0 }, { x: to, y: 0 }],
    lengthM, lanes: 1, roadClass: 'residential', oneway: true,
  };
}

const META = {
  bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
  projection: 'webMercator' as const,
  generatedAt: '', sourceHash: '', scriptVersion: '',
};

const GRAPH: RoadGraph = {
  meta: META,
  edges: [edge(10, 1, 2, 100), edge(20, 2, 3, 100)],
  junctions: [],
  boundaryEdges: [10, 20],
};

const DEMAND: Demand = {
  seed: 42,
  durationSec: 60,
  sources: [{
    id: 'src',
    spawnEdgeId: 10,
    vehiclesPerHour: 3600, // 1 per sim-second
    destinations: [{ exitEdgeId: 20, weight: 1 }],
  }],
};

function makeWorld() {
  const sab = new SharedArrayBuffer(computeSabByteLength());
  const views = createSabViews(sab);
  const store = new VehicleStore(views);
  const router = new Router(GRAPH);
  const edgesById = new Map(GRAPH.edges.map((e) => [e.id, e]));
  return { store, router, edgesById };
}

describe('SpawnController', () => {
  it('emits spawns at roughly the configured rate over many ticks', () => {
    const { store, router, edgesById } = makeWorld();
    const rng = (() => { let s = 42; return () => { s = (s + 1) | 0; return ((s * 2654435761) >>> 0) / 4294967296; }; })();
    const ctrl = new SpawnController(DEMAND, router, edgesById, rng);
    const dt = 1 / 30;
    let count = 0;
    for (let i = 0; i < 30 * 60; i++) { // 60 sim-seconds at 30 Hz
      count += ctrl.step(dt, store).length;
    }
    // Expected ~60 spawns; allow wide statistical tolerance.
    expect(count).toBeGreaterThan(30);
    expect(count).toBeLessThan(120);
  });

  it('initializes a spawned vehicle on the spawn edge with valid route', () => {
    const { store, router, edgesById } = makeWorld();
    const rng = () => 0.0; // forces "spawn this tick"
    const ctrl = new SpawnController(DEMAND, router, edgesById, rng);
    const spawned = ctrl.step(0.5, store);
    expect(spawned.length).toBe(1);
    const slot = spawned[0]!;
    expect(store.views.edgeId[slot]).toBe(10);
    expect(store.views.lane[slot]).toBe(0);
    expect(store.views.edgeProgress[slot]).toBe(0);
    expect(store.views.vehicleType[slot]).toBe(VEHICLE_TYPE_CAR);
    expect(store.views.speed[slot]).toBeCloseTo(ROAD_CLASS_SPEED_MPS.residential, 5);
    expect(store.getRoute(slot)).toEqual(new Uint32Array([10, 20]));
  });

  it('holds the spawn when the spawn lane is blocked within 10 m', () => {
    const { store, router, edgesById } = makeWorld();
    // Pre-occupy slot 0 on the spawn edge at progress 0.05 (5 m of 100 m).
    store.spawn({
      posX: 5, posY: 0, heading: 0, speed: 0, accel: 0,
      edgeId: 10, edgeProgress: 0.05, lane: 0,
      vehicleType: VEHICLE_TYPE_CAR, route: new Uint32Array([10, 20]),
    });
    const rng = () => 0.0; // forces "would spawn"
    const ctrl = new SpawnController(DEMAND, router, edgesById, rng);
    const spawned = ctrl.step(0.5, store);
    expect(spawned.length).toBe(0); // blocked
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @traffic-lens/sim test`
Expected: FAIL on spawn tests.

- [ ] **Step 3: Implement `spawn.ts`**

Create `packages/sim/src/spawn.ts`:

```ts
import type {
  Demand, DemandSource, Edge, EdgeId, RoadGraph,
} from '@traffic-lens/shared';
import { ROAD_CLASS_SPEED_MPS, VEHICLE_TYPE_CAR } from '@traffic-lens/shared';
import type { Router } from './routing.ts';
import type { VehicleStore } from './vehicle-store.ts';

const SPAWN_BLOCK_DISTANCE_M = 10;

interface ResolvedSource {
  source: DemandSource;
  spawnEdge: Edge;
  ratePerSec: number;
  cumulativeWeights: number[]; // for binary-search destination pick
  totalWeight: number;
}

export class SpawnController {
  private readonly sources: ResolvedSource[] = [];

  constructor(
    demand: Demand,
    private readonly router: Router,
    private readonly edgesById: ReadonlyMap<EdgeId, Edge>,
    private readonly rng: () => number,
  ) {
    for (const src of demand.sources) {
      const spawnEdge = edgesById.get(src.spawnEdgeId);
      if (!spawnEdge) {
        throw new Error(`SpawnController: spawnEdgeId ${src.spawnEdgeId} not in graph`);
      }
      let cumulative = 0;
      const cumulativeWeights: number[] = [];
      for (const dest of src.destinations) {
        cumulative += dest.weight;
        cumulativeWeights.push(cumulative);
      }
      this.sources.push({
        source: src,
        spawnEdge,
        ratePerSec: src.vehiclesPerHour / 3600,
        cumulativeWeights,
        totalWeight: cumulative,
      });
    }
  }

  step(dt: number, store: VehicleStore): number[] {
    const spawned: number[] = [];
    for (const rs of this.sources) {
      if (this.rng() >= rs.ratePerSec * dt) continue;
      const dest = this.pickDestination(rs);
      const route = this.router.findRoute(rs.source.spawnEdgeId, dest.exitEdgeId);
      if (!route) continue;
      if (this.spawnLaneBlocked(rs.spawnEdge, store)) continue;
      const slot = store.spawn({
        posX: rs.spawnEdge.geometry[0]!.x,
        posY: rs.spawnEdge.geometry[0]!.y,
        heading: this.headingOf(rs.spawnEdge),
        speed: ROAD_CLASS_SPEED_MPS[rs.spawnEdge.roadClass],
        accel: 0,
        edgeId: rs.source.spawnEdgeId,
        edgeProgress: 0,
        lane: 0,
        vehicleType: VEHICLE_TYPE_CAR,
        route: new Uint32Array(route),
      });
      spawned.push(slot);
    }
    return spawned;
  }

  private pickDestination(rs: ResolvedSource): { exitEdgeId: EdgeId } {
    const r = this.rng() * rs.totalWeight;
    for (let i = 0; i < rs.cumulativeWeights.length; i++) {
      if (r < rs.cumulativeWeights[i]!) {
        return rs.source.destinations[i]!;
      }
    }
    return rs.source.destinations[rs.source.destinations.length - 1]!;
  }

  private spawnLaneBlocked(spawnEdge: Edge, store: VehicleStore): boolean {
    const blockProgress = SPAWN_BLOCK_DISTANCE_M / spawnEdge.lengthM;
    const v = store.views;
    let blocked = false;
    store.forEachActive((idx) => {
      if (blocked) return;
      if (v.edgeId[idx] !== spawnEdge.id) return;
      if (v.lane[idx] !== 0) return;
      if (v.edgeProgress[idx]! < blockProgress) blocked = true;
    });
    return blocked;
  }

  private headingOf(edge: Edge): number {
    const a = edge.geometry[0]!;
    const b = edge.geometry[1]!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
}

// Helper for tests using the full graph type — narrow it down here.
// (kept inline because graph isn't needed at runtime; SpawnController takes
// edgesById directly.)
export function buildEdgesById(graph: RoadGraph): Map<EdgeId, Edge> {
  return new Map(graph.edges.map((e) => [e.id, e]));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @traffic-lens/sim test`
Expected: all spawn tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/spawn.ts packages/sim/tests/spawn.test.ts
git commit -m "Add Poisson spawn controller"
```

---

## Task 13: World + Tick orchestrator

`World` is the top-level state container assembled at `init` time. `tick(world)` runs the 9-step tick loop from the spec, plus a couple of helpers for advancing route position and despawning at end-of-route.

We keep `World` field-public for tick.ts to mutate; we don't need encapsulation in the worker boundary.

**Files:**
- Create: `packages/sim/src/world.ts`
- Create: `packages/sim/src/tick.ts`
- Create: `packages/sim/tests/tick.integration.test.ts`
- Modify: `packages/sim/src/index.ts`

- [ ] **Step 1: Write the failing integration test**

Create `packages/sim/tests/tick.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Demand, RoadGraph } from '@traffic-lens/shared';
import { computeSabByteLength, MAX_VEHICLES, STATE_ACTIVE } from '@traffic-lens/shared';
import { World, TICK_HZ } from '../src/world.ts';
import { tick } from '../src/tick.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAPH = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.graph.json'), 'utf8')) as RoadGraph;
const DEMAND = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.demand.json'), 'utf8')) as Demand;

describe('tick integration on Koramangala', () => {
  it('runs 60 sim-seconds without crashing or producing NaN', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const world = World.init({ graph: GRAPH, demand: DEMAND, sab, seed: 42 });
    const ticks = TICK_HZ * 60;
    for (let i = 0; i < ticks; i++) tick(world);

    const v = world.views;
    for (let i = 0; i < MAX_VEHICLES; i++) {
      if (v.state[i] !== STATE_ACTIVE) continue;
      expect(Number.isNaN(v.posX[i])).toBe(false);
      expect(Number.isNaN(v.posY[i])).toBe(false);
      expect(Number.isNaN(v.speed[i])).toBe(false);
      expect(v.speed[i]).toBeGreaterThanOrEqual(-0.01);
    }
    expect(v.control.tickNumber[0]).toBe(ticks);
    expect(v.control.simWallClockSec[0]).toBeCloseTo(60, 1);
  });

  it('produces some active vehicles within the first 30 sim-seconds', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const world = World.init({ graph: GRAPH, demand: DEMAND, sab, seed: 42 });
    for (let i = 0; i < TICK_HZ * 30; i++) tick(world);
    expect(world.store.activeCount()).toBeGreaterThan(0);
  });

  it('after 180 sim-seconds, vehicles have despawned (routes complete)', () => {
    const sab = new SharedArrayBuffer(computeSabByteLength());
    const world = World.init({ graph: GRAPH, demand: DEMAND, sab, seed: 42 });
    let everSpawned = 0;
    let endActive = 0;
    for (let i = 0; i < TICK_HZ * 180; i++) {
      const before = world.store.activeCount();
      tick(world);
      const after = world.store.activeCount();
      if (after > before) everSpawned += after - before;
      endActive = after;
    }
    expect(everSpawned).toBeGreaterThan(0);
    // Active count after 3 minutes should be far less than the cumulative
    // number ever spawned — i.e. vehicles ARE despawning.
    expect(endActive).toBeLessThan(everSpawned);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @traffic-lens/sim test`
Expected: FAIL (`Cannot find module '../src/world.ts'`).

- [ ] **Step 3: Implement `world.ts`**

Create `packages/sim/src/world.ts`:

```ts
import type {
  Demand, Edge, EdgeId, Junction, JunctionId, RoadGraph, SignalledJunction,
} from '@traffic-lens/shared';
import { createSabViews, type SabViews } from '@traffic-lens/shared';
import { Router } from './routing.ts';
import { VehicleStore } from './vehicle-store.ts';
import { PerceptionIndex } from './perception.ts';
import { SpawnController } from './spawn.ts';
import { createRng } from './prng.ts';
import { createSignalState, type SignalState } from './signals.ts';
import { DEFAULT_IDM_PARAMS, type IdmParams } from './idm.ts';
import { DEFAULT_MOBIL_PARAMS, type MobilParams } from './mobil.ts';
import { DEFAULT_PRIORITY_PARAMS, type PriorityParams } from './priority.ts';

export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

export interface WorldInit {
  graph: RoadGraph;
  demand: Demand;
  sab: SharedArrayBuffer;
  seed?: number;
}

export class World {
  graph!: RoadGraph;
  demand!: Demand;
  views!: SabViews;
  rng!: () => number;
  router!: Router;
  store!: VehicleStore;
  perception!: PerceptionIndex;
  spawnController!: SpawnController;
  edgesById!: Map<EdgeId, Edge>;
  junctionsById!: Map<JunctionId, Junction>;
  signalStates!: Map<JunctionId, SignalState>;
  signalPlans!: Map<JunctionId, SignalledJunction>;
  idmParams: IdmParams = DEFAULT_IDM_PARAMS;
  mobilParams: MobilParams = DEFAULT_MOBIL_PARAMS;
  priorityParams: PriorityParams = DEFAULT_PRIORITY_PARAMS;

  static init({ graph, demand, sab, seed }: WorldInit): World {
    const w = new World();
    w.graph = graph;
    w.demand = demand;
    w.views = createSabViews(sab);
    w.rng = createRng(seed ?? demand.seed);
    w.router = new Router(graph);
    w.store = new VehicleStore(w.views);
    w.perception = new PerceptionIndex();
    w.edgesById = new Map(graph.edges.map((e) => [e.id, e]));
    w.junctionsById = new Map(graph.junctions.map((j) => [j.id, j]));
    w.signalStates = new Map();
    w.signalPlans = new Map();
    for (const j of graph.junctions) {
      if (j.kind === 'signalled') {
        w.signalStates.set(j.id, createSignalState());
        w.signalPlans.set(j.id, j);
      }
    }
    w.spawnController = new SpawnController(demand, w.router, w.edgesById, w.rng);
    return w;
  }
}
```

- [ ] **Step 4: Implement `tick.ts`**

Create `packages/sim/src/tick.ts`:

```ts
import type { Edge, EdgeId, Junction, JunctionId, SignalledJunction } from '@traffic-lens/shared';
import { STATE_ACTIVE } from '@traffic-lens/shared';
import { ROAD_CLASS_SPEED_MPS } from '@traffic-lens/shared';
import { idmAcceleration } from './idm.ts';
import { advanceSignalState, isEdgeGreen } from './signals.ts';
import { canEnterPriorityJunction } from './priority.ts';
import { TICK_DT, type World } from './world.ts';

const BRAKING_LOOKAHEAD_M = 50;

export function tick(world: World): void {
  // 1. Signals
  for (const [jid, state] of world.signalStates) {
    const plan = world.signalPlans.get(jid)!.defaultSignalPlan;
    advanceSignalState(state, plan, TICK_DT);
  }

  // 2. Spawn
  world.spawnController.step(TICK_DT, world.store);

  // 3. Perception index rebuild
  world.perception.rebuild(world.store, world.edgesById);

  // 4-7. Per-vehicle decision + integrate
  const v = world.views;
  world.store.forEachActive((i) => {
    const edge = world.edgesById.get(v.edgeId[i]!)!;
    const v0 = ROAD_CLASS_SPEED_MPS[edge.roadClass];
    const leader = world.perception.findLeader(v.edgeId[i]!, v.lane[i]!, v.edgeProgress[i]!);
    let leaderSpeed = 0;
    let gap = Infinity;
    if (leader) {
      leaderSpeed = v.speed[leader.slotIdx]!;
      gap = leader.gapM;
    }

    // Virtual leader for intersection control.
    const distToJunction = (1 - v.edgeProgress[i]!) * edge.lengthM;
    if (distToJunction < BRAKING_LOOKAHEAD_M) {
      const junction = world.junctionsById.get(edge.toJunction);
      if (junction) {
        const virt = virtualLeaderFor(world, junction, edge, v.edgeId[i]!, distToJunction, v.speed[i]!);
        if (virt !== null && virt < gap) {
          gap = virt;
          leaderSpeed = 0;
        }
      }
    }

    const accel = idmAcceleration({
      speed: v.speed[i]!,
      leaderSpeed,
      gap,
      v0,
      params: world.idmParams,
    });
    v.accel[i] = accel;
    const newSpeed = Math.max(0, v.speed[i]! + accel * TICK_DT);
    v.speed[i] = newSpeed;

    // Integrate position along the polyline.
    const dProgress = (newSpeed * TICK_DT) / edge.lengthM;
    let progress = v.edgeProgress[i]! + dProgress;

    if (progress >= 1) {
      // Advance to next route edge.
      const route = world.store.getRoute(i)!;
      const nextRouteIdx = v.routeIdx[i]! + 1;
      if (nextRouteIdx >= route.length) {
        world.store.despawn(i);
        return;
      }
      const carry = (progress - 1) * edge.lengthM;
      const nextEdgeId = route[nextRouteIdx]!;
      const nextEdge = world.edgesById.get(nextEdgeId)!;
      v.edgeId[i] = nextEdgeId;
      v.routeIdx[i] = nextRouteIdx;
      v.lane[i] = Math.min(v.lane[i]!, nextEdge.lanes - 1);
      progress = Math.min(0.99, carry / nextEdge.lengthM);
      v.edgeProgress[i] = progress;
      writePos(v, i, nextEdge, progress);
    } else {
      v.edgeProgress[i] = progress;
      writePos(v, i, edge, progress);
    }
    v.state[i] = STATE_ACTIVE;
  });

  // 8-9. Update control region.
  v.control.tickNumber[0]! += 1;
  v.control.simWallClockSec[0]! += TICK_DT;
}

function writePos(v: World['views'], i: number, edge: Edge, progress: number): void {
  // Linear interpolation along the polyline based on cumulative segment lengths.
  // For Plan B we approximate by lerping start→end (the geometry is a polyline
  // but the cumulative arc-length form is a deferred optimization).
  const a = edge.geometry[0]!;
  const b = edge.geometry[edge.geometry.length - 1]!;
  const t = progress;
  v.posX[i] = a.x + (b.x - a.x) * t;
  v.posY[i] = a.y + (b.y - a.y) * t;
  v.heading[i] = Math.atan2(b.y - a.y, b.x - a.x);
}

function virtualLeaderFor(
  world: World,
  junction: Junction,
  incomingEdge: Edge,
  incomingEdgeId: EdgeId,
  distToJunction: number,
  selfSpeed: number,
): number | null {
  if (junction.kind === 'signalled') {
    const plan = (junction as SignalledJunction).defaultSignalPlan;
    const state = world.signalStates.get(junction.id);
    if (!state) return null;
    if (isEdgeGreen(state, plan, incomingEdgeId)) return null;
    return distToJunction;
  }
  // priority junction
  const priorityEdges = new Set(junction.priorityEdges);
  if (priorityEdges.has(incomingEdgeId)) return null;
  if (priorityEdges.size === 0) return null;
  // Collect priority approaches: vehicles currently traversing any priority edge,
  // ordered by their own distance to the junction.
  const approaches: { distanceToJunction: number; speed: number }[] = [];
  const v = world.views;
  for (const pEdgeId of priorityEdges) {
    const pEdge = world.edgesById.get(pEdgeId);
    if (!pEdge) continue;
    world.store.forEachActive((idx) => {
      if (v.edgeId[idx] !== pEdgeId) return;
      const d = (1 - v.edgeProgress[idx]!) * pEdge.lengthM;
      approaches.push({ distanceToJunction: d, speed: v.speed[idx]! });
    });
  }
  const ok = canEnterPriorityJunction({
    selfDistanceToJunction: distToJunction,
    selfSpeed,
    priorityApproaches: approaches,
    params: world.priorityParams,
  });
  return ok ? null : distToJunction;
}
```

- [ ] **Step 5: Update barrel export**

Modify `packages/sim/src/index.ts`:

```ts
export { World, TICK_HZ, TICK_DT } from './world.ts';
export { tick } from './tick.ts';
export { createRng } from './prng.ts';
export { idmAcceleration, DEFAULT_IDM_PARAMS } from './idm.ts';
export { mobilDecision, DEFAULT_MOBIL_PARAMS } from './mobil.ts';
export { canEnterPriorityJunction, DEFAULT_PRIORITY_PARAMS } from './priority.ts';
export { Router } from './routing.ts';
export { VehicleStore } from './vehicle-store.ts';
export { PerceptionIndex } from './perception.ts';
export { SpawnController } from './spawn.ts';
export { createSignalState, advanceSignalState, isEdgeGreen } from './signals.ts';
```

- [ ] **Step 6: Run tests**

Run: `pnpm -F @traffic-lens/sim test`
Expected: all sim tests pass, including the new integration tests.

- [ ] **Step 7: Run typecheck**

Run: `pnpm -r typecheck`
Expected: all packages typecheck cleanly.

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/world.ts packages/sim/src/tick.ts packages/sim/src/index.ts packages/sim/tests/tick.integration.test.ts
git commit -m "Add World container and tick orchestrator"
```

---

## Task 14: Determinism test + Web Worker entry

The final task locks down two contracts:
1. **Determinism:** same `(graph, demand, seed)` → byte-identical SAB after N ticks.
2. **Worker entry:** the `worker.ts` file is wired up to handle the `ToWorkerMessage` protocol and run the tick loop. We can't fully unit-test it in Node (no Worker scope), so we test the message-dispatch function in isolation.

**Files:**
- Create: `packages/sim/tests/determinism.test.ts`
- Create: `packages/sim/src/worker-driver.ts` (pure, testable driver logic)
- Create: `packages/sim/src/worker.ts` (thin Web Worker shell that calls into worker-driver)
- Create: `packages/sim/tests/worker-driver.test.ts`
- Modify: `packages/sim/src/index.ts`

- [ ] **Step 1: Write the failing determinism test**

Create `packages/sim/tests/determinism.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Demand, RoadGraph } from '@traffic-lens/shared';
import { computeSabByteLength } from '@traffic-lens/shared';
import { World, TICK_HZ } from '../src/world.ts';
import { tick } from '../src/tick.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAPH = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.graph.json'), 'utf8')) as RoadGraph;
const DEMAND = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.demand.json'), 'utf8')) as Demand;

function runForTicks(seed: number, ticks: number): Uint8Array {
  const sab = new SharedArrayBuffer(computeSabByteLength());
  const world = World.init({ graph: GRAPH, demand: DEMAND, sab, seed });
  for (let i = 0; i < ticks; i++) tick(world);
  return new Uint8Array(sab.slice(0));
}

describe('determinism', () => {
  it('two runs with the same seed produce byte-identical SAB after 60 sim-seconds', () => {
    const ticks = TICK_HZ * 60;
    const a = runForTicks(42, ticks);
    const b = runForTicks(42, ticks);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        throw new Error(`SAB byte ${i} differs: ${a[i]} vs ${b[i]}`);
      }
    }
  });

  it('different seeds produce different SAB state', () => {
    const ticks = TICK_HZ * 30;
    const a = runForTicks(42, ticks);
    const b = runForTicks(43, ticks);
    let diffs = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
    expect(diffs).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run determinism test to verify**

Run: `pnpm -F @traffic-lens/sim test tests/determinism.test.ts`
Expected: PASS for both tests (the sim is already deterministic by construction). If it fails, the implementer must trace any source of non-determinism (Map iteration order, etc.) before continuing.

- [ ] **Step 3: Implement `worker-driver.ts`** (pure, testable)

Create `packages/sim/src/worker-driver.ts`:

```ts
import type {
  FromWorkerMessage, ToWorkerMessage,
} from '@traffic-lens/shared';
import { World } from './world.ts';
import { tick } from './tick.ts';

export interface WorkerDriver {
  handleMessage(msg: ToWorkerMessage): FromWorkerMessage | null;
  isRunning(): boolean;
  runOneTick(): void;
}

export function createWorkerDriver(): WorkerDriver {
  let world: World | null = null;
  let running = false;
  let speedMultiplier = 1;

  return {
    handleMessage(msg) {
      try {
        switch (msg.type) {
          case 'init':
            world = World.init({ graph: msg.graph, demand: msg.demand, sab: msg.sab });
            running = false;
            return { type: 'ready' };
          case 'play':
            if (!world) throw new Error('Cannot play before init');
            running = true;
            return null;
          case 'pause':
            running = false;
            return null;
          case 'step':
            if (!world) throw new Error('Cannot step before init');
            tick(world);
            return null;
          case 'setSpeed':
            if (msg.multiplier <= 0) throw new Error('multiplier must be positive');
            speedMultiplier = msg.multiplier;
            return null;
          case 'reseed':
            if (!world) throw new Error('Cannot reseed before init');
            world = World.init({
              graph: world.graph,
              demand: { ...world.demand, seed: msg.seed },
              sab: world.views.posX.buffer as SharedArrayBuffer,
              seed: msg.seed,
            });
            return null;
        }
      } catch (err) {
        return {
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          tick: world ? world.views.control.tickNumber[0]! : 0,
        };
      }
    },
    isRunning(): boolean {
      return running;
    },
    runOneTick(): void {
      if (!world || !running) return;
      const steps = Math.max(1, Math.round(speedMultiplier));
      for (let i = 0; i < steps; i++) tick(world);
    },
  };
}
```

- [ ] **Step 4: Write the failing worker-driver test**

Create `packages/sim/tests/worker-driver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Demand, RoadGraph } from '@traffic-lens/shared';
import { computeSabByteLength } from '@traffic-lens/shared';
import { createWorkerDriver } from '../src/worker-driver.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAPH = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.graph.json'), 'utf8')) as RoadGraph;
const DEMAND = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.demand.json'), 'utf8')) as Demand;

describe('worker-driver', () => {
  it('init returns ready and accepts subsequent control messages', () => {
    const d = createWorkerDriver();
    const sab = new SharedArrayBuffer(computeSabByteLength());
    expect(d.handleMessage({ type: 'init', graph: GRAPH, demand: DEMAND, sab }))
      .toEqual({ type: 'ready' });
    expect(d.handleMessage({ type: 'play' })).toBeNull();
    expect(d.isRunning()).toBe(true);
    expect(d.handleMessage({ type: 'pause' })).toBeNull();
    expect(d.isRunning()).toBe(false);
  });

  it('step advances the tick number by one', () => {
    const d = createWorkerDriver();
    const sab = new SharedArrayBuffer(computeSabByteLength());
    d.handleMessage({ type: 'init', graph: GRAPH, demand: DEMAND, sab });
    const before = new Uint32Array(sab, 0, 1)[0]!;
    d.handleMessage({ type: 'step' });
    const after = new Uint32Array(sab, 0, 1)[0]!;
    expect(after).toBe(before + 1);
  });

  it('rejects play before init with an error message', () => {
    const d = createWorkerDriver();
    const result = d.handleMessage({ type: 'play' });
    expect(result).toMatchObject({ type: 'error' });
  });

  it('rejects setSpeed with non-positive multiplier', () => {
    const d = createWorkerDriver();
    const sab = new SharedArrayBuffer(computeSabByteLength());
    d.handleMessage({ type: 'init', graph: GRAPH, demand: DEMAND, sab });
    const result = d.handleMessage({ type: 'setSpeed', multiplier: 0 });
    expect(result).toMatchObject({ type: 'error' });
  });

  it('runOneTick is a no-op when paused', () => {
    const d = createWorkerDriver();
    const sab = new SharedArrayBuffer(computeSabByteLength());
    d.handleMessage({ type: 'init', graph: GRAPH, demand: DEMAND, sab });
    const before = new Uint32Array(sab, 0, 1)[0]!;
    d.runOneTick();
    expect(new Uint32Array(sab, 0, 1)[0]!).toBe(before);
  });
});
```

- [ ] **Step 5: Run tests to verify**

Run: `pnpm -F @traffic-lens/sim test`
Expected: all tests pass (the worker-driver was implemented in Step 3, so the tests added in Step 4 are red-green-tested as a pair).

- [ ] **Step 6: Implement the thin Web Worker shell**

Create `packages/sim/src/worker.ts`:

```ts
/// <reference lib="webworker" />
import type { ToWorkerMessage } from '@traffic-lens/shared';
import { createWorkerDriver } from './worker-driver.ts';
import { TICK_DT } from './world.ts';

const driver = createWorkerDriver();
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let timer: ReturnType<typeof setInterval> | null = null;

ctx.onmessage = (event: MessageEvent<ToWorkerMessage>) => {
  const reply = driver.handleMessage(event.data);
  if (reply) ctx.postMessage(reply);
  // Start/stop the tick interval based on driver running state.
  if (driver.isRunning() && timer === null) {
    timer = setInterval(() => driver.runOneTick(), TICK_DT * 1000);
  } else if (!driver.isRunning() && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
};
```

- [ ] **Step 7: Re-export the driver from the barrel**

Modify `packages/sim/src/index.ts` — add at the end:

```ts
export { createWorkerDriver, type WorkerDriver } from './worker-driver.ts';
```

- [ ] **Step 8: Final verification**

Run: `pnpm -r test`
Expected: all packages pass — shared, osm-preprocess (still passing from Plan A), sim.

Run: `pnpm -r typecheck`
Expected: all packages typecheck.

- [ ] **Step 9: Commit**

```bash
git add packages/sim/src/worker-driver.ts packages/sim/src/worker.ts packages/sim/src/index.ts packages/sim/tests/determinism.test.ts packages/sim/tests/worker-driver.test.ts
git commit -m "Add determinism test, worker driver, and Web Worker entry"
```

---

## Self-Review checklist

After execution, the implementer should be able to answer:

- [ ] All 14 tasks committed with green tests on each.
- [ ] `pnpm -r test` is green across `shared`, `osm-preprocess`, `sim`.
- [ ] `pnpm -r typecheck` is green.
- [ ] `data/koramangala.demand.json` references only real `boundaryEdges` from `data/koramangala.graph.json`.
- [ ] Determinism test passes — same seed gives byte-identical SAB.
- [ ] 60-second integration run on the real Koramangala graph: no NaN, no negative speeds, at least some vehicles spawned, at least some vehicles despawned.

If any of the above is red at the end of Task 14, do not advance to Plan C — fix the issue in a follow-up commit first.

---

## Out-of-scope (deferred to Plan C or later)

- Polyline arc-length interpolation (Plan B lerps endpoints; visually approximate, fine for headless tests).
- Double-buffered SAB snapshots for renderer interpolation — added in Plan C if and only if visible tearing appears.
- MOBIL invocation inside the tick loop. The Plan B tick uses IDM only for the longitudinal dynamics; MOBIL is built and unit-tested but not called per-tick yet. Plan C wires it in once we can visualize lane behavior. (Lane changes for routing-required turns also wait for Plan C.)
- Worker bundling via Vite. The `worker.ts` file is written but not bundled in Plan B; that's Plan C's `vite.config.ts` job.
- Spawning's RNG draw mixes spawn-or-not with destination-pick on the same `rng()` stream — fine for determinism, slightly biased statistically; tune in Plan B+ if it shows in metrics.
