# Traffic-Lens

Bengaluru traffic simulator. See `docs/superpowers/specs/2026-06-12-traffic-lens-foundation-design.md` for the design of the foundation slice.

## Prerequisites

- Node 22+ (`nvm use`)
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)

## Setup

```bash
pnpm install
```

## Generating the road graph

See `packages/osm-preprocess/README.md`.

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
