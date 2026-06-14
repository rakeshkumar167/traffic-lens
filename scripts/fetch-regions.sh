#!/usr/bin/env bash
# Fetch OSM road extracts for Bangalore areas via Overpass and preprocess each
# into data/<key>.graph.json. Pure local code — no LLM tokens.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OVERPASS="https://overpass-api.de/api/interpreter"

# key|label-unused|minLon,minLat,maxLon,maxLat
AREAS=(
  "indiranagar|77.635,12.965,77.655,12.985"
  "hsr-layout|77.635,12.905,77.660,12.925"
  "jayanagar|77.580,12.920,77.600,12.945"
  "mg-road|77.595,12.965,77.620,12.985"
  "whitefield|77.720,12.965,77.745,12.985"
  "btm-layout|77.605,12.905,77.625,12.925"
)

for entry in "${AREAS[@]}"; do
  key="${entry%%|*}"
  bbox="${entry##*|}"
  IFS=',' read -r minLon minLat maxLon maxLat <<< "$bbox"
  raw="$ROOT/data/raw/$key.osm"
  out="$ROOT/data/$key.graph.json"
  echo "=== $key  bbox=$bbox ==="
  q="[out:xml][timeout:120];(way[\"highway\"]($minLat,$minLon,$maxLat,$maxLon););(._;>;);out body;"
  curl -s -G "$OVERPASS" --data-urlencode "data=$q" -o "$raw"
  bytes=$(wc -c < "$raw" | tr -d ' ')
  echo "  raw osm: $bytes bytes"
  if [ "$bytes" -lt 2000 ]; then echo "  !! tiny/failed fetch, head:"; head -c 300 "$raw"; echo; continue; fi
  ( cd "$ROOT/packages/osm-preprocess" && TMPDIR=/tmp pnpm exec tsx src/cli.ts --in "$raw" --out "$out" --bbox "$bbox" 2>&1 | tail -1 )
  sleep 3
done
echo "=== DONE ==="
