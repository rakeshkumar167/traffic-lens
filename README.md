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
