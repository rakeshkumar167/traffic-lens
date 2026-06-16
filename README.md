# Traffic Simulator — Bangalore

An interactive, microscopic traffic simulator over Bengaluru's Koramangala road
network. Draw a region on the map, choose where vehicles enter, and watch
individual cars route, queue, obey traffic signals, and flow in real time.

The simulation runs in a Web Worker and shares state with the renderer through a
`SharedArrayBuffer`; the map is MapLibre GL with a deck.gl overlay.

![Traffic Simulator screenshot](screenshot.png)

## What it does

- **Draw a region** — drag a rectangle anywhere inside the loaded network (a grey
  guide outline shows where roads exist).
- **Pick entry points** — candidate spawn points on the region's boundary are
  highlighted; click to multi-select which ones spawn vehicles (so you control the
  load instead of flooding every edge).
- **Set intensity & Start** — a slider sets the per-entry spawn rate; the camera
  fits to your region and vehicles begin entering. Destinations are chosen
  randomly among the region's exit roads.
- **Microscopic sim** — per-vehicle car-following (IDM), lane changes (MOBIL),
  give-way priority junctions, and fixed-cycle traffic signals.
- **Live visuals** — vehicles render as oriented top-down **car sprites**
  (coloured fleet), smoothly interpolated between sim ticks; **traffic signals**
  show per-approach green/red **stop-bars** that update with the signal cycle.
- **Playback** — play/pause, step, and 0.5×–4× speed; live tick / vehicle-count /
  render-FPS readouts.
- **First-visit help** — a modal explains the flow; reopen anytime via the "?" in
  the navbar.

## Prerequisites

- Node 22+ (`nvm use`)
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)

## Running locally

```bash
pnpm install
pnpm dev
```

Then open <http://localhost:5173/>.

> **Browser support:** the app needs `SharedArrayBuffer`, which requires the page
> to be **cross-origin isolated** *and* in a **secure context** (HTTPS or
> `localhost`). The dev server sets `Cross-Origin-Opener-Policy: same-origin` and
> `Cross-Origin-Embedder-Policy: credentialless`. `credentialless` lets MapLibre
> fetch OpenStreetMap basemap tiles while staying isolated, but is supported in
> **Chrome and Firefox only — not Safari**.

## Commands

```bash
pnpm dev          # Vite dev server (port 5173)
pnpm build        # production build → dist/ (also emits data/*.json to dist/data)
pnpm preview      # preview the production build (port 5174)
pnpm typecheck    # tsc across root + all workspace packages
pnpm test         # run all package test suites (vitest)
pnpm preprocess   # regenerate the road graph from raw OSM (see osm-preprocess)
```

## Deployment (Vercel)

The repo deploys as a static site. `vercel.ts` sets the build/output and the
COOP/`credentialless` COEP headers, and the Vite build copies `data/*.json` into
`dist/data/` so the app can fetch the graph at runtime. Pushing to `main` triggers
an automatic deploy.

## Regions / generating road graphs

Each region is preprocessed **offline** from an OpenStreetMap extract into
`data/<area>.graph.json` (Web Mercator / EPSG:3857 geometry, junctions, and
signal plans) — pure local code, no API keys or LLM tokens. The app ships
several Bangalore areas (Koramangala, Indiranagar, HSR Layout, Jayanagar,
MG Road, Whitefield, BTM Layout), selectable from the navbar **Area** dropdown.

To add an area:

1. Add an entry to `src/config/regions.ts` (`key`, `label`, `file`).
2. Fetch + preprocess it. `scripts/fetch-regions.sh` does this for the bundled
   areas (Overpass download → `osm-preprocess` CLI); adapt the bbox list, or run
   the CLI directly:
   ```
   pnpm -F @traffic-lens/osm-preprocess exec tsx src/cli.ts \
     --in data/raw/<area>.osm --out data/<area>.graph.json \
     --bbox <minLon,minLat,maxLon,maxLat>
   ```
3. The Vite build copies `data/*.json` into `dist/data/` automatically.

Each graph is ~3–5 MB JSON (~0.3–0.45 MB gzipped); only the selected region is
loaded at a time. See `packages/osm-preprocess/README.md` for CLI details.

## Architecture

```
src/                       Vite + React app
  components/              Navbar, SetupBar, PlaybackBar, HelpModal, MapView
  render/                  deck.gl layers: vehicles (car sprites), signals,
                           entry-point markers, region clip → demand glue,
                           interpolation, projection
  hooks/                   worker lifecycle + render frame loop
  state/                   SharedArrayBuffer allocation + asset loading
packages/shared/           SAB layout, road-graph & demand types, message protocol
packages/sim/              pure TS engine + Web Worker entry:
                           tick loop, IDM, MOBIL, routing (A*), signals,
                           priority junctions, region clip & demand builder
packages/osm-preprocess/   Node CLI: raw OSM → road graph JSON
data/                      preprocessed graph + sample demand (committed)
docs/superpowers/specs/    design docs per feature
```

### How the pieces fit

1. The app loads the full graph, then `clipGraph` trims it to the drawn rectangle
   and classifies boundary-crossing edges as entries (inward) / exits (outward).
2. `buildDemand` turns the **selected** entries + all exits into a demand the
   worker simulates; only selected points spawn.
3. The worker ticks at 30 Hz, writing per-vehicle position/heading/speed/state
   into the SAB. The renderer reads the SAB each frame and interpolates between
   the previous and current tick for smooth motion.
4. Signal state is derived on the main thread from the elapsed sim time
   (`simWallClockSec`) plus each junction's plan — no extra shared state.

## Known limitations / next up

- **Signal model is basic:** most signalled junctions in the data have a single
  approach (always green); real multi-approach NS/EW phasing and size-based
  cycle timing are the next planned rework (requires regenerating the graph).
- Region selection is limited to the preprocessed Koramangala extent; covering
  more of Bangalore would need on-demand region extraction or tiling.
- The car sprite sheet is ~2.6 MB (room to downscale).
