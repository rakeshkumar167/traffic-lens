#!/usr/bin/env bash
# Fetch OSM road extracts for Bangalore areas via Overpass and preprocess each
# into data/<key>.graph.json. Idempotent (skips existing graphs), retries across
# endpoints with pacing to dodge Overpass rate limits. Pure local code, no tokens.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENDPOINTS=("https://overpass-api.de/api/interpreter" "https://overpass.kumi.systems/api/interpreter")

# key|minLon,minLat,maxLon,maxLat  (koramangala ships separately)
AREAS=(
  "indiranagar|77.635,12.965,77.655,12.985"
  "hsr-layout|77.635,12.905,77.660,12.925"
  "jayanagar|77.580,12.920,77.600,12.945"
  "mg-road|77.595,12.965,77.620,12.985"
  "whitefield|77.720,12.965,77.745,12.985"
  "btm-layout|77.605,12.905,77.625,12.925"
  "malleshwaram|77.560,12.990,77.585,13.010"
  "basavanagudi|77.560,12.935,77.585,12.955"
  "rajajinagar|77.545,12.985,77.570,13.005"
  "shivajinagar|77.595,12.980,77.615,13.000"
  "marathahalli|77.690,12.950,77.715,12.970"
  "bellandur|77.660,12.920,77.685,12.940"
  "hebbal|77.580,13.030,77.605,13.050"
  "kr-puram|77.690,12.990,77.715,13.010"
  "electronic-city|77.655,12.835,77.685,12.860"
  "jp-nagar|77.575,12.895,77.600,12.915"
  "banashankari|77.540,12.910,77.565,12.935"
  "domlur|77.630,12.955,77.650,12.975"
  # Outer Ring Road — eastern IT-corridor arc (Silk Board -> Hebbal). Fills the
  # gaps between the already-present Bellandur/Marathahalli/KR Puram/Hebbal boxes.
  "central-silk-board|77.612,12.907,77.637,12.927"
  "agara|77.632,12.915,77.657,12.935"
  "mahadevapura|77.675,12.982,77.700,13.002"
  "hennur|77.630,13.018,77.655,13.038"
  "nagawara|77.615,13.033,77.640,13.053"
)

fetch_area() {
  local key="$1" bbox="$2"
  local out="$ROOT/data/$key.graph.json" raw="$ROOT/data/raw/$key.osm"
  if [ -f "$out" ]; then echo "=== $key: graph exists, skip ==="; return 0; fi
  IFS=',' read -r mlon mlat Mlon Mlat <<< "$bbox"
  local q="[out:xml][timeout:120];(way[\"highway\"]($mlat,$mlon,$Mlat,$Mlon););(._;>;);out body;"
  for attempt in 1 2 3 4; do
    local ep="${ENDPOINTS[$(( (attempt-1) % ${#ENDPOINTS[@]} ))]}"
    curl -s --data-urlencode "data=$q" "$ep" -o "$raw"
    local b; b=$(wc -c < "$raw" | tr -d ' ')
    if [ "$b" -ge 2000 ]; then
      echo "=== $key: raw $b bytes (attempt $attempt) ==="
      ( cd "$ROOT/packages/osm-preprocess" && TMPDIR=/tmp pnpm exec tsx src/cli.ts --in "$raw" --out "$out" --bbox "$bbox" 2>&1 | tail -1 )
      return 0
    fi
    echo "  $key attempt $attempt failed ($b bytes), waiting..."
    sleep 25
  done
  echo "!! $key FAILED after retries"
}

for entry in "${AREAS[@]}"; do
  fetch_area "${entry%%|*}" "${entry##*|}"
  sleep 12
done
echo "=== DONE ==="
