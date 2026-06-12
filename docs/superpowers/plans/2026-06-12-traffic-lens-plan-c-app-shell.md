# Plan C — App Shell Implementation Plan (Vite + MapLibre + deck.gl + Worker)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Vite + React app at the repo root that loads `data/koramangala.graph.json` + `data/koramangala.demand.json`, spawns the sim Web Worker built in Plan B, allocates a shared `SharedArrayBuffer`, and renders ~300 vehicles per frame at 60 FPS on top of a MapLibre base map using deck.gl, with a minimal playback bar (Play/Pause/Step/Speed). Vehicles must visibly enter at boundary edges, drive through the network, queue at signals, yield at priority junctions, and exit.

**Architecture:** Three responsibilities in the main thread:
1. **App shell (`src/App.tsx`)** — owns SAB, demand, graph, worker handle. Composes `MapView` + `PlaybackBar`.
2. **Map view (`src/components/MapView.tsx`)** — owns the MapLibre map instance and the deck.gl `MapboxOverlay`. Re-creates the vehicle layer each frame with fresh SAB data; the GPU upload is one typed-array reference.
3. **Playback bar (`src/components/PlaybackBar.tsx`)** — pure React component. Buttons call into the worker handle from `App.tsx`.

A `useFrameLoop` hook drives `requestAnimationFrame`. Each frame we read the SAB's `tickNumber` and use a JS-side previous-tick snapshot of (posX, posY, heading) for interpolation between sim ticks — no SAB layout change required. The sim worker continues to write the SAB at 30 Hz; the renderer reads at 60 FPS with `alpha ∈ [0, 1)` interpolation. No `Atomics.wait`/`notify`; the renderer is allowed to read mid-write because positions only move by a few cm per tick at 30 Hz and any tear is invisible.

For Plan C v0 we use **MapLibre's free demotiles** (`https://demotiles.maplibre.org/style.json`) as the base map — no API key, no rate-limit risk in development. Swapping to MapTiler or a self-hosted style is a one-line change in `src/config/map.ts`.

**Tech Stack:**
- Vite 5 + React 18 + TypeScript 5.5
- `maplibre-gl` 4.x
- `deck.gl` 9.x (specifically `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/mapbox`)
- `@vitejs/plugin-react` for the dev/build pipeline
- vitest for the worker-boot smoke test (already configured in the sim package)

No backend, no SSR, no CI for now.

**Inputs:**
- `data/koramangala.graph.json` (Plan A output, 5121 edges)
- `data/koramangala.demand.json` (Plan B output, 4 sources)
- `@traffic-lens/sim` worker (Plan B output)
- `@traffic-lens/shared` SAB layout + message types

**Out of scope** (deferred to a later milestone):
- Editing UI (density sliders, road click, signal-timing editor)
- Heatmaps / analytics
- Two-wheelers / lane filtering
- LOD switching
- Scenario save/load
- Mobile / touch
- Playwright / E2E

---

## File Structure

### New files at the repo root
- `index.html`
- `vite.config.ts`
- `vercel.ts`
- `tsconfig.json` (app-level tsconfig that extends `tsconfig.base.json`)

### `src/`
- `main.tsx` — React root
- `App.tsx` — composes everything
- `vite-env.d.ts` — Vite ambient types
- `config/map.ts` — initial camera + style URL
- `components/MapView.tsx` — MapLibre + deck.gl overlay + vehicle layer
- `components/PlaybackBar.tsx` — bottom bar UI
- `hooks/useWorker.ts` — worker lifecycle hook: init, ready, control message helpers
- `hooks/useFrameLoop.ts` — `requestAnimationFrame` loop with FPS measurement
- `state/sab.ts` — allocate SAB, expose typed-array views to consumers
- `render/interpolation.ts` — previous-tick snapshot + linear interpolation
- `render/vehicle-layer.ts` — factory that returns a `ScatterplotLayer` from current SAB views

### Modified
- `package.json` (root) — add Vite + React + deck.gl + MapLibre deps; `dev`/`build`/`preview` scripts
- `pnpm-workspace.yaml` — unchanged (workspace already covers `packages/*`)
- `README.md` — add "running the app" section (dev URL, COOP/COEP note)

### Not added
- No global state library (Zustand/Redux). Simple `useState` in `App.tsx` and a worker-handle ref are enough for the slice.
- No CSS framework. A single `src/index.css` with ~30 lines of plain CSS for the playback bar.
- No worker bundler plugin beyond Vite's built-in `?worker` import — that ships with Vite 5.

---

## Task 1: Scaffold the root Vite + React app

**Files:**
- Modify: `package.json` (root)
- Create: `tsconfig.json` (root, app-level)
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/vite-env.d.ts`
- Create: `src/index.css`

- [ ] **Step 1: Modify root `package.json`** to add dev/build/preview/typecheck scripts and dependencies:

```json
{
  "name": "traffic-lens",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "pnpm -r --if-present typecheck && tsc --noEmit -p tsconfig.json",
    "test": "pnpm -r --if-present test",
    "preprocess": "pnpm -F @traffic-lens/osm-preprocess preprocess"
  },
  "dependencies": {
    "@traffic-lens/shared": "workspace:*",
    "@traffic-lens/sim": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "maplibre-gl": "^4.7.1",
    "@deck.gl/core": "^9.0.32",
    "@deck.gl/layers": "^9.0.32",
    "@deck.gl/mapbox": "^9.0.32"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vite": "^5.4.10",
    "@vitejs/plugin-react": "^4.3.3",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Create root `tsconfig.json`**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "types": ["node", "vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"],
  "exclude": ["dist", "node_modules", "packages"]
}
```

- [ ] **Step 3: Create `vite.config.ts`** with COOP/COEP for `SharedArrayBuffer`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// COOP/COEP headers are required for SharedArrayBuffer (spec: shared-state schema).
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    headers: crossOriginIsolation,
  },
  preview: {
    port: 5174,
    headers: crossOriginIsolation,
  },
  worker: {
    format: 'es',
  },
});
```

- [ ] **Step 4: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Traffic Lens — Koramangala</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Create `src/App.tsx` — placeholder for now (real wiring in Task 9)**

```tsx
export function App() {
  return (
    <div style={{ padding: 16 }}>
      <h1>Traffic Lens</h1>
      <p>Foundation slice — wiring in progress.</p>
    </div>
  );
}
```

- [ ] **Step 7: Create `src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 8: Create `src/index.css` — minimal global styles**

```css
* {
  box-sizing: border-box;
}

html,
body,
#root {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0f1318;
  color: #e8eef5;
}
```

- [ ] **Step 9: Install dependencies and verify**

Run: `pnpm install`
Expected: succeeds, adds React/Vite/deck.gl/maplibre.

Run: `pnpm typecheck`
Expected: passes for the root + all packages.

Run: `pnpm dev`
Expected: Vite starts at `http://localhost:5173/`, page shows "Traffic Lens — Foundation slice — wiring in progress." Stop the dev server (Ctrl+C).

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json vite.config.ts index.html src/main.tsx src/App.tsx src/vite-env.d.ts src/index.css pnpm-lock.yaml
git commit -m "Scaffold root Vite + React app shell"
```

---

## Task 2: Map config + asset loading

Static URL for the base map style and the initial camera. Asset URLs for the graph + demand JSON (loaded via `fetch` from `/data/...`).

**Files:**
- Create: `src/config/map.ts`
- Create: `src/state/assets.ts`

- [ ] **Step 1: Create `src/config/map.ts`**

```ts
// Koramangala 5th Block centroid. Numbers come from the bbox used by Plan A's
// preprocessor (data/koramangala.graph.json meta.bbox) — rough centre.
export const INITIAL_VIEW = {
  longitude: 77.6275,
  latitude: 12.938,
  zoom: 15,
  pitch: 0,
  bearing: 0,
};

// Free no-API-key style provided by MapLibre upstream. Swap to MapTiler or a
// self-hosted style by replacing this URL.
export const BASE_STYLE_URL = 'https://demotiles.maplibre.org/style.json';
```

- [ ] **Step 2: Create `src/state/assets.ts`**

```ts
import type { Demand, RoadGraph } from '@traffic-lens/shared';

export interface AppAssets {
  readonly graph: RoadGraph;
  readonly demand: Demand;
}

// Vite serves anything in /public — but we keep graph + demand under /data so
// the preprocessor and the app share the same path. Vite's default `publicDir`
// is `public/`; we override below in vite.config to also serve `/data/...`.
// For now we just `fetch` them at app startup.
export async function loadAssets(): Promise<AppAssets> {
  const [graphRes, demandRes] = await Promise.all([
    fetch('/data/koramangala.graph.json'),
    fetch('/data/koramangala.demand.json'),
  ]);
  if (!graphRes.ok) throw new Error(`Failed to load graph: ${graphRes.status}`);
  if (!demandRes.ok) throw new Error(`Failed to load demand: ${demandRes.status}`);
  const graph = (await graphRes.json()) as RoadGraph;
  const demand = (await demandRes.json()) as Demand;
  return { graph, demand };
}
```

- [ ] **Step 3: Add `publicDir` and `data` static-serving to `vite.config.ts`**

Vite's defaults won't serve `/data/...`. The simplest fix: tell Vite to treat `data/` as additional static assets via the `publicDir` option set to `public` (default) and use a small plugin or `assetsInclude`. Cleanest approach: symlink `public/data` → `../data`. But symlinks in workspaces can be brittle. Use Vite's `server.fs.allow` plus an alias resolver.

Actually the simplest pattern: add a Vite plugin that resolves `/data/*` requests to the repo's `data/` directory. Modify `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Serve files under /data/* from the repo's `data/` directory, both in dev
// and in production. The preprocessor writes there; the app reads from there.
function dataAssetsPlugin() {
  const dataDir = resolve(__dirname, 'data');
  return {
    name: 'traffic-lens-data',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/data/')) return next();
        const filePath = resolve(dataDir, req.url.replace('/data/', ''));
        if (!filePath.startsWith(dataDir) || !existsSync(filePath)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(filePath));
      });
    },
    configurePreviewServer(server: import('vite').PreviewServer) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/data/')) return next();
        const filePath = resolve(dataDir, req.url.replace('/data/', ''));
        if (!filePath.startsWith(dataDir) || !existsSync(filePath)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(filePath));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), dataAssetsPlugin()],
  server: {
    port: 5173,
    headers: crossOriginIsolation,
  },
  preview: {
    port: 5174,
    headers: crossOriginIsolation,
  },
  worker: {
    format: 'es',
  },
});
```

For production builds, the `/data/*` URLs work via `configurePreviewServer`. The eventual Vercel deploy will need static routing for `/data/*` — handled in `vercel.ts` (Task 10).

- [ ] **Step 4: Verify dev server serves the graph**

Run: `pnpm dev`

Open another terminal and run:
```bash
curl -sI http://localhost:5173/data/koramangala.graph.json | head -1
```
Expected: `HTTP/1.1 200 OK`. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/config/map.ts src/state/assets.ts vite.config.ts
git commit -m "Add map config, asset loader, and data static-serving"
```

---

## Task 3: SAB allocation helper

A tiny helper that allocates the `SharedArrayBuffer` and returns the `SabViews`. We need it both in `App.tsx` (to read positions for the renderer) and the worker handle (to pass to `init`).

**Files:**
- Create: `src/state/sab.ts`

- [ ] **Step 1: Create `src/state/sab.ts`**

```ts
import { computeSabByteLength, createSabViews, type SabViews } from '@traffic-lens/shared';

export interface SimSab {
  readonly sab: SharedArrayBuffer;
  readonly views: SabViews;
}

export function allocateSimSab(): SimSab {
  if (typeof SharedArrayBuffer === 'undefined') {
    throw new Error(
      'SharedArrayBuffer is unavailable — page must be served with ' +
      'COOP/COEP headers (Cross-Origin-Opener-Policy: same-origin, ' +
      'Cross-Origin-Embedder-Policy: require-corp).',
    );
  }
  const sab = new SharedArrayBuffer(computeSabByteLength());
  const views = createSabViews(sab);
  return { sab, views };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/state/sab.ts
git commit -m "Add SAB allocation helper"
```

---

## Task 4: Worker lifecycle hook

`useWorker` boots `@traffic-lens/sim` as a Web Worker via Vite's `?worker` import syntax, sends `init`, awaits `ready`, and exposes typed methods that wrap `postMessage`.

**Files:**
- Create: `src/hooks/useWorker.ts`

- [ ] **Step 1: Create `src/hooks/useWorker.ts`**

```ts
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Demand, FromWorkerMessage, RoadGraph,
} from '@traffic-lens/shared';
// Vite's `?worker` import gives us a Worker constructor for the sim entry.
import SimWorker from '../../packages/sim/src/worker.ts?worker';

export interface WorkerHandle {
  readonly ready: boolean;
  readonly error: string | null;
  play(): void;
  pause(): void;
  step(): void;
  setSpeed(multiplier: number): void;
  reseed(seed: number): void;
}

export interface UseWorkerArgs {
  readonly graph: RoadGraph | null;
  readonly demand: Demand | null;
  readonly sab: SharedArrayBuffer | null;
}

export function useWorker({ graph, demand, sab }: UseWorkerArgs): WorkerHandle {
  const workerRef = useRef<Worker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!graph || !demand || !sab) return;

    const worker = new SimWorker({ type: 'module' });
    workerRef.current = worker;
    setReady(false);
    setError(null);

    worker.onmessage = (event: MessageEvent<FromWorkerMessage>) => {
      if (event.data.type === 'ready') setReady(true);
      else if (event.data.type === 'error') setError(event.data.message);
    };
    worker.onerror = (event) => setError(event.message ?? 'Worker error');

    worker.postMessage({ type: 'init', graph, demand, sab });

    return () => {
      worker.terminate();
      workerRef.current = null;
      setReady(false);
    };
  }, [graph, demand, sab]);

  // Stable callbacks — workerRef is always read at call time, so the identities
  // can be memoized once and consumers won't churn useEffect/useCallback deps.
  const actions = useMemo(() => ({
    play: () => workerRef.current?.postMessage({ type: 'play' }),
    pause: () => workerRef.current?.postMessage({ type: 'pause' }),
    step: () => workerRef.current?.postMessage({ type: 'step' }),
    setSpeed: (multiplier: number) =>
      workerRef.current?.postMessage({ type: 'setSpeed', multiplier }),
    reseed: (seed: number) =>
      workerRef.current?.postMessage({ type: 'reseed', seed }),
  }), []);

  return { ready, error, ...actions };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useWorker.ts
git commit -m "Add useWorker hook for sim worker lifecycle"
```

---

## Task 5: Frame loop hook with FPS measurement

`useFrameLoop` runs a `requestAnimationFrame` loop, calls a render callback with `dt` and the current `tickNumber` from the SAB control region, and tracks rolling FPS.

**Files:**
- Create: `src/hooks/useFrameLoop.ts`

The rAF effect must NOT depend on `onFrame` or `tickNumberView` — those identities change every render of the caller, and re-running the effect tears down + recreates the loop every render. Stash both in refs (the `advanced-event-handler-refs` pattern) so the effect runs only when `enabled` flips.

- [ ] **Step 1: Create `src/hooks/useFrameLoop.ts`**

```ts
import { useEffect, useRef, useState } from 'react';

export interface FrameStats {
  readonly renderFps: number;
  readonly tickNumber: number;
}

export interface UseFrameLoopArgs {
  readonly enabled: boolean;
  readonly tickNumberView: Uint32Array | null;
  readonly onFrame: (nowMs: number, dtMs: number) => void;
}

export function useFrameLoop({ enabled, tickNumberView, onFrame }: UseFrameLoopArgs): FrameStats {
  const [stats, setStats] = useState<FrameStats>({ renderFps: 0, tickNumber: 0 });
  // Keep onFrame + tickNumberView behind refs so the rAF effect can stay
  // dependent only on `enabled`. Otherwise every render of the caller would
  // recreate `onFrame`, retrigger the effect, and tear down/recreate the loop.
  const onFrameRef = useRef(onFrame);
  const tickViewRef = useRef(tickNumberView);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);
  useEffect(() => { tickViewRef.current = tickNumberView; }, [tickNumberView]);

  useEffect(() => {
    if (!enabled) return;

    let rafId: number | null = null;
    let lastMs = 0;
    let fpsAccumMs = 0;
    let fpsFrames = 0;

    const loop = (nowMs: number) => {
      const dtMs = lastMs === 0 ? 0 : nowMs - lastMs;
      lastMs = nowMs;
      onFrameRef.current(nowMs, dtMs);

      fpsAccumMs += dtMs;
      fpsFrames += 1;
      if (fpsAccumMs >= 500) {
        const fps = (fpsFrames / fpsAccumMs) * 1000;
        const tickView = tickViewRef.current;
        setStats({
          renderFps: Math.round(fps),
          tickNumber: tickView ? tickView[0]! : 0,
        });
        fpsAccumMs = 0;
        fpsFrames = 0;
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [enabled]);

  return stats;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useFrameLoop.ts
git commit -m "Add useFrameLoop hook with FPS measurement"
```

---

## Task 6: Render interpolation snapshot

We maintain a JS-side snapshot of the previous tick's positions. Each frame, if `tickNumber` has advanced, we copy current SAB positions to the snapshot. Then we compute `alpha = (now - tickStartMs) / TICK_MS` and lerp.

For Plan C v0, we keep this very simple: store a single previous snapshot and the wall-clock millisecond at which it was captured.

**Files:**
- Create: `src/render/interpolation.ts`

- [ ] **Step 1: Create `src/render/interpolation.ts`**

```ts
import { MAX_VEHICLES, type SabViews } from '@traffic-lens/shared';

const TICK_MS = 1000 / 30; // 30 Hz sim

export interface InterpSnapshot {
  posX: Float32Array;
  posY: Float32Array;
  heading: Float32Array;
  tickNumber: number;
  capturedAtMs: number;
}

export function createSnapshot(): InterpSnapshot {
  return {
    posX: new Float32Array(MAX_VEHICLES),
    posY: new Float32Array(MAX_VEHICLES),
    heading: new Float32Array(MAX_VEHICLES),
    tickNumber: 0,
    capturedAtMs: 0,
  };
}

// Returns the interpolation alpha (0..1) for the current frame.
// Side-effect: when the SAB tickNumber has advanced past `snapshot.tickNumber`,
// copies the SAB's current positions into the snapshot before returning.
export function updateSnapshotAndAlpha(
  snapshot: InterpSnapshot,
  views: SabViews,
  nowMs: number,
): number {
  const sabTick = views.control.tickNumber[0]!;
  if (sabTick !== snapshot.tickNumber) {
    // New tick observed — capture *current* SAB state as the new "previous".
    snapshot.posX.set(views.posX);
    snapshot.posY.set(views.posY);
    snapshot.heading.set(views.heading);
    snapshot.tickNumber = sabTick;
    snapshot.capturedAtMs = nowMs;
    return 0;
  }
  const elapsedMs = nowMs - snapshot.capturedAtMs;
  return Math.min(1, elapsedMs / TICK_MS);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/render/interpolation.ts
git commit -m "Add tick-to-tick interpolation snapshot"
```

---

## Task 7: deck.gl vehicle layer factory

A factory function that takes current SAB views + the interpolation snapshot + an `alpha` and returns a `ScatterplotLayer` with `MAX_VEHICLES` data items. Only vehicles with `state === STATE_ACTIVE` are visible (radius=0 for inactive slots is the cheap trick).

The positions are in MapLibre **lon/lat**, but the SAB stores **Web Mercator world** coordinates (from Plan A). We need to project back: deck.gl ships with `WebMercatorViewport` for this, but the simpler path is `webMercatorToLonLat()` — a 4-line inverse projection. Plan A's `lonLatToWebMercator()` uses `EARTH_RADIUS_M = 6378137`. The inverse is straightforward.

**Files:**
- Create: `src/render/vehicle-layer.ts`

- [ ] **Step 1: Create `src/render/vehicle-layer.ts`**

```ts
import { ScatterplotLayer } from '@deck.gl/layers';
import {
  MAX_VEHICLES, STATE_ACTIVE, type SabViews,
} from '@traffic-lens/shared';
import type { InterpSnapshot } from './interpolation.ts';

const EARTH_RADIUS_M = 6378137;
const HALF_PI = Math.PI / 2;

// Inverse of Plan A's lonLatToWebMercator.
function webMercatorToLonLat(x: number, y: number): [number, number] {
  const lon = (x / EARTH_RADIUS_M) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - HALF_PI) * (180 / Math.PI);
  return [lon, lat];
}

interface VehicleDatum {
  readonly slotIdx: number;
}

const DATA: VehicleDatum[] = Array.from({ length: MAX_VEHICLES }, (_, i) => ({ slotIdx: i }));

interface BuildArgs {
  readonly views: SabViews;
  readonly snapshot: InterpSnapshot;
  readonly alpha: number;
  readonly layerId: string;
}

export function buildVehicleLayer({ views, snapshot, alpha, layerId }: BuildArgs): ScatterplotLayer<VehicleDatum> {
  return new ScatterplotLayer<VehicleDatum>({
    id: layerId,
    data: DATA,
    pickable: false,
    radiusUnits: 'meters',
    getRadius: (d: VehicleDatum) =>
      views.state[d.slotIdx] === STATE_ACTIVE ? 2.5 : 0,
    getPosition: (d: VehicleDatum) => {
      const i = d.slotIdx;
      const x = snapshot.posX[i]! + (views.posX[i]! - snapshot.posX[i]!) * alpha;
      const y = snapshot.posY[i]! + (views.posY[i]! - snapshot.posY[i]!) * alpha;
      const [lon, lat] = webMercatorToLonLat(x, y);
      return [lon, lat];
    },
    getFillColor: (d: VehicleDatum) => {
      // Colour by speed (m/s). 0 → red, 14 → green.
      const speed = views.speed[d.slotIdx]!;
      const t = Math.max(0, Math.min(1, speed / 14));
      const r = Math.round(255 * (1 - t));
      const g = Math.round(255 * t);
      return [r, g, 40, 230];
    },
    // Update triggers force per-frame attribute re-eval. We re-create the
    // layer instance each frame anyway, but these make explicit which fields
    // change between renders.
    updateTriggers: {
      getRadius: alpha,
      getPosition: alpha,
      getFillColor: alpha,
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/render/vehicle-layer.ts
git commit -m "Add deck.gl ScatterplotLayer factory for vehicles"
```

---

## Task 8: MapView component

Owns the MapLibre map and the deck.gl `MapboxOverlay`. Re-creates the vehicle layer each frame and feeds it to the overlay. Drives the frame loop.

**Files:**
- Create: `src/components/MapView.tsx`

- [ ] **Step 1: Create `src/components/MapView.tsx`**

```tsx
import { useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { SabViews } from '@traffic-lens/shared';
import { INITIAL_VIEW, BASE_STYLE_URL } from '../config/map.ts';
import { useFrameLoop } from '../hooks/useFrameLoop.ts';
import { createSnapshot, updateSnapshotAndAlpha } from '../render/interpolation.ts';
import { buildVehicleLayer } from '../render/vehicle-layer.ts';

export interface MapViewProps {
  readonly views: SabViews | null;
  readonly running: boolean;
  readonly onStats: (renderFps: number, tickNumber: number) => void;
}

export function MapView({ views, running, onStats }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const snapshot = useMemo(createSnapshot, []);

  // Init map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE_URL,
      center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
      zoom: INITIAL_VIEW.zoom,
      pitch: INITIAL_VIEW.pitch,
      bearing: INITIAL_VIEW.bearing,
    });
    mapRef.current = map;

    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    overlayRef.current = overlay;
    map.addControl(overlay as unknown as maplibregl.IControl);

    return () => {
      overlay.finalize();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  const tickView = views ? views.control.tickNumber : null;

  const stats = useFrameLoop({
    enabled: !!views,
    tickNumberView: tickView,
    onFrame: (nowMs) => {
      if (!views || !overlayRef.current) return;
      const alpha = updateSnapshotAndAlpha(snapshot, views, nowMs);
      overlayRef.current.setProps({
        layers: [buildVehicleLayer({
          views,
          snapshot,
          alpha,
          layerId: 'vehicles',
        })],
      });
    },
  });

  // Suppress unused-warning for `running` (Plan C uses it later for cosmetic UI).
  void running;

  useEffect(() => {
    onStats(stats.renderFps, stats.tickNumber);
  }, [stats.renderFps, stats.tickNumber, onStats]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/MapView.tsx
git commit -m "Add MapView component with MapLibre + deck.gl overlay"
```

---

## Task 9: PlaybackBar component + App wiring

Bottom bar with Play/Pause/Step/Speed and counters. `App.tsx` now orchestrates: load assets, allocate SAB, mount `useWorker`, render `<MapView>` and `<PlaybackBar>`.

**Files:**
- Create: `src/components/PlaybackBar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create `src/components/PlaybackBar.tsx`**

```tsx
import { useState } from 'react';

export interface PlaybackBarProps {
  readonly ready: boolean;
  readonly running: boolean;
  readonly tickNumber: number;
  readonly activeVehicles: number;
  readonly renderFps: number;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onStep: () => void;
  readonly onSetSpeed: (m: number) => void;
}

const SPEEDS = [0.5, 1, 2, 4] as const;

export function PlaybackBar({
  ready, running, tickNumber, activeVehicles, renderFps,
  onPlay, onPause, onStep, onSetSpeed,
}: PlaybackBarProps) {
  const [speed, setSpeed] = useState(1);

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      padding: '8px 16px', display: 'flex', alignItems: 'center',
      gap: 16, background: 'rgba(15, 19, 24, 0.85)',
      borderTop: '1px solid #2a3340', color: '#e8eef5', fontSize: 13,
    }}>
      <button onClick={running ? onPause : onPlay} disabled={!ready} style={btn}>
        {running ? 'Pause' : 'Play'}
      </button>
      <button onClick={onStep} disabled={!ready || running} style={btn}>Step</button>
      <span>Speed:</span>
      {SPEEDS.map((s) => (
        <button
          key={s}
          onClick={() => { setSpeed(s); onSetSpeed(s); }}
          disabled={!ready}
          style={{ ...btn, ...(speed === s ? activeBtn : null) }}
        >
          {s}×
        </button>
      ))}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
        <span>Tick: {tickNumber}</span>
        <span>Vehicles: {activeVehicles}</span>
        <span>Render FPS: {renderFps}</span>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '6px 12px', background: '#1f2934', color: '#e8eef5',
  border: '1px solid #2a3340', borderRadius: 4, cursor: 'pointer',
  fontSize: 13,
};

const activeBtn: React.CSSProperties = { background: '#3a5a78', borderColor: '#5077a0' };
```

- [ ] **Step 2: Rewrite `src/App.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { STATE_ACTIVE, MAX_VEHICLES } from '@traffic-lens/shared';
import type { Demand, RoadGraph } from '@traffic-lens/shared';
import { loadAssets } from './state/assets.ts';
import { allocateSimSab } from './state/sab.ts';
import { useWorker } from './hooks/useWorker.ts';
import { MapView } from './components/MapView.tsx';
import { PlaybackBar } from './components/PlaybackBar.tsx';

export function App() {
  const [graph, setGraph] = useState<RoadGraph | null>(null);
  const [demand, setDemand] = useState<Demand | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sim = useMemo(allocateSimSab, []);

  useEffect(() => {
    let cancelled = false;
    loadAssets()
      .then((a) => {
        if (cancelled) return;
        setGraph(a.graph);
        setDemand(a.demand);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const worker = useWorker({ graph, demand, sab: sim.sab });

  const [running, setRunning] = useState(false);
  const [renderFps, setRenderFps] = useState(0);
  const [tickNumber, setTickNumber] = useState(0);

  const handleStats = useCallback((fps: number, tick: number) => {
    setRenderFps(fps);
    setTickNumber(tick);
  }, []);

  const handlePlay = useCallback(() => {
    worker.play();
    setRunning(true);
  }, [worker]);

  const handlePause = useCallback(() => {
    worker.pause();
    setRunning(false);
  }, [worker]);

  // Count active vehicles by scanning the state typed-array.
  const [activeCount, setActiveCount] = useState(0);
  useEffect(() => {
    if (!worker.ready) return;
    const id = window.setInterval(() => {
      let n = 0;
      for (let i = 0; i < MAX_VEHICLES; i++) {
        if (sim.views.state[i] === STATE_ACTIVE) n++;
      }
      setActiveCount(n);
    }, 250);
    return () => window.clearInterval(id);
  }, [worker.ready, sim.views.state]);

  if (loadError) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Traffic Lens</h1>
        <p style={{ color: '#ff8888' }}>Failed to load assets: {loadError}</p>
      </div>
    );
  }

  if (worker.error) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Traffic Lens</h1>
        <p style={{ color: '#ff8888' }}>Sim worker error: {worker.error}</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }

  return (
    <>
      <MapView
        views={worker.ready ? sim.views : null}
        running={running}
        onStats={handleStats}
      />
      <PlaybackBar
        ready={worker.ready}
        running={running}
        tickNumber={tickNumber}
        activeVehicles={activeCount}
        renderFps={renderFps}
        onPlay={handlePlay}
        onPause={handlePause}
        onStep={worker.step}
        onSetSpeed={worker.setSpeed}
      />
    </>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Manual visual test**

Run: `pnpm dev`

Open `http://localhost:5173/` in Chrome or Firefox. Expected behavior:
- Within 2 seconds: MapLibre base map loads centred over Koramangala-ish coordinates (the demotiles style is a world map; you may need to scroll/zoom — that's fine for v0).
- Playback bar appears at the bottom.
- Click Play. After ~1 second, small coloured dots should appear at boundary edges and start moving along the road network. The dots are positioned in the world's lon/lat — they may sit on top of empty water on the demotiles style because the demotiles style doesn't show neighborhood-level roads. THAT IS EXPECTED. The vehicles are at the right coordinates; the demo style just lacks zoom-16 features.
- Tick counter increments. Render FPS reads ~60.
- Vehicles count climbs to roughly 80-200 in the first minute.
- Click Pause: tick number freezes; vehicles freeze.
- Click Step (only enabled when paused): tick advances by 1.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/components/PlaybackBar.tsx src/App.tsx
git commit -m "Wire MapView + PlaybackBar in App with worker lifecycle"
```

---

## Task 10: Vercel headers + README

Production headers for SAB; README updated with run instructions.

**Files:**
- Create: `vercel.ts`
- Modify: `README.md`

- [ ] **Step 1: Create `vercel.ts`**

Note: the spec mentions `vercel.ts` as the new way to configure Vercel. If the implementer hits issues installing `@vercel/config` (it is a relatively new package), fall back to `vercel.json` with the same content as the `headers` field below.

Try `vercel.ts` first:

```ts
import { routes, type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'vite',
  buildCommand: 'pnpm build',
  outputDirectory: 'dist',
  headers: [
    routes.cacheControl('/data/(.*)', { public: true, maxAge: '1 day', immutable: false }),
    {
      source: '/(.*)',
      headers: [
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
      ],
    },
  ],
};
```

If `@vercel/config` is not installable, create `vercel.json` instead with this content:

```json
{
  "framework": "vite",
  "buildCommand": "pnpm build",
  "outputDirectory": "dist",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    },
    {
      "source": "/data/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=86400" }
      ]
    }
  ]
}
```

Use whichever is installable. Do NOT commit both.

- [ ] **Step 2: Update `README.md`**

Append (or create) sections covering local dev, requirements, and the COOP/COEP requirement:

```markdown
## Running locally

Requires Node 22+ and pnpm 9.

```bash
pnpm install
pnpm dev
```

Then open <http://localhost:5173/>.

The dev server sets `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` so the page can use
`SharedArrayBuffer`. If you serve a build statically, you'll need to set
those headers yourself; `vercel.ts` / `vercel.json` does this for Vercel.

## Layout

- `data/` — preprocessed road graph + demand JSON (committed).
- `packages/osm-preprocess/` — Node CLI that emits the graph (Plan A).
- `packages/sim/` — pure TS sim engine + Web Worker entry (Plan B).
- `packages/shared/` — SAB layout, road-graph types, message protocol.
- `src/` — Vite + React app shell (Plan C).
```

- [ ] **Step 3: Commit**

```bash
# Commit whichever of vercel.ts / vercel.json you created plus the README.
git add vercel.ts README.md     # or: git add vercel.json README.md
git commit -m "Add Vercel headers config and README run instructions"
```

---

## Task 11: Worker-boot smoke test

The spec's Layer-3 testing strategy is "Worker-boot smoke test (SAB non-zero within 2 s)". We add a Vitest test for this in the `sim` package — it uses `node:worker_threads` to actually spawn a worker, posts an `init`, and verifies the SAB sees a non-zero `tickNumber` within 2 seconds of starting the tick loop.

Web Workers in browsers and Node `worker_threads` are not interchangeable; we test the equivalent here by driving the `worker-driver` (already done in Plan B) and by adding a fresh smoke test that drives the same code over `MessagePort` to prove the message protocol works end-to-end in an event-loop setting.

**Files:**
- Create: `packages/sim/tests/worker-smoke.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import type { Demand, FromWorkerMessage, RoadGraph, ToWorkerMessage } from '@traffic-lens/shared';
import { computeSabByteLength } from '@traffic-lens/shared';
import { createWorkerDriver } from '../src/worker-driver.ts';
import { TICK_DT } from '../src/world.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAPH = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.graph.json'), 'utf8')) as RoadGraph;
const DEMAND = JSON.parse(readFileSync(resolve(HERE, '../../../data/koramangala.demand.json'), 'utf8')) as Demand;

describe('worker smoke (MessageChannel)', () => {
  it('drives the sim through a message channel and observes SAB advance within 2s', async () => {
    const { port1, port2 } = new MessageChannel();
    const driver = createWorkerDriver();
    const replies: FromWorkerMessage[] = [];
    port2.on('message', (msg: ToWorkerMessage) => {
      const reply = driver.handleMessage(msg);
      if (reply) port2.postMessage(reply);
    });
    port1.on('message', (msg: FromWorkerMessage) => {
      replies.push(msg);
    });

    const sab = new SharedArrayBuffer(computeSabByteLength());
    port1.postMessage({ type: 'init', graph: GRAPH, demand: DEMAND, sab });

    // Wait until `ready` is received or 2 s pass.
    const start = Date.now();
    while (!replies.some((r) => r.type === 'ready') && Date.now() - start < 2000) {
      await new Promise((r) => setImmediate(r));
    }
    expect(replies.some((r) => r.type === 'ready')).toBe(true);

    port1.postMessage({ type: 'play' });

    // Drive the runOneTick loop ourselves (in production the worker has its own interval).
    const tickEnd = Date.now() + 1500;
    while (Date.now() < tickEnd) {
      driver.runOneTick();
      await new Promise((r) => setTimeout(r, TICK_DT * 1000));
    }

    const tickView = new Uint32Array(sab, 0, 1);
    expect(tickView[0]).toBeGreaterThan(0);

    port1.close();
    port2.close();
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm -F @traffic-lens/sim test tests/worker-smoke.test.ts`
Expected: PASS within ~3 seconds total. Tick counter > 0.

- [ ] **Step 3: Final repo-wide test pass**

Run: `pnpm -r test`
Expected: shared (9) + osm-preprocess (39) + sim (55, with the new smoke test) = 103 tests passing.

Run: `pnpm typecheck`
Expected: all packages + root pass.

- [ ] **Step 4: Commit**

```bash
git add packages/sim/tests/worker-smoke.test.ts
git commit -m "Add worker-boot smoke test driven via MessageChannel"
```

---

## Final manual checklist

Open the app and confirm the slice's success criteria:

- [ ] `pnpm dev` starts cleanly at port 5173.
- [ ] Browser console has no errors after load.
- [ ] Network tab shows `data/koramangala.graph.json` returning 200 with `Content-Type: application/json`.
- [ ] Page shows the playback bar; Play is enabled within ~2s of load.
- [ ] Click Play. Tick counter increments steadily.
- [ ] Vehicle dots appear and move. The "Vehicles" counter shows >0 within a few seconds and climbs to roughly 80–200 within a minute.
- [ ] Click Pause. Tick counter stops; vehicles freeze.
- [ ] Click Step while paused: tick advances by 1.
- [ ] Click 2× / 4× speed: tick rate visibly speeds up.
- [ ] Render FPS stays ≥ 50 on a mid-range laptop.

If any item fails, file a follow-up rather than blocking the Plan C completion — Plan C's contract is "the app shell runs end-to-end against the Plan A + Plan B contracts and shows moving vehicles". Visual polish (a basemap that actually shows Koramangala's streets, custom car icons, signal-phase indicators, hover info) is a follow-up milestone.

---

## Out-of-scope (deferred)

- Custom car icon (`IconLayer` with a sprite) — for v0, dots are enough to validate the SAB → GPU plumbing.
- Edge IDs / junction IDs / signal-phase overlays — debug toggle is the future milestone.
- Real Koramangala street-level basemap — drop a MapTiler key into `src/config/map.ts` when we have one.
- Reseed UI button — the worker supports it; surface it once we need scenario variation.
- Restart-on-worker-crash — spec says no auto-restart; we render an error + reload button.
- COOP/COEP test in Playwright — add when we set up E2E.
