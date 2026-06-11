# @traffic-lens/osm-preprocess

CLI that converts an OSM extract into a `RoadGraph` JSON file.

## Usage

```bash
pnpm preprocess -- \
  --in data/raw/koramangala.osm.pbf \
  --out data/koramangala.graph.json \
  --bbox 77.615,12.928,77.640,12.948
```

## Where to get the OSM extract

Use BBBike's free extract service:
- URL: https://extract.bbbike.org/
- Format: `Protocolbuffer (PBF)`
- Bbox for Koramangala 5th/6th Block: `77.615, 12.928, 77.640, 12.948`
- Save to `data/raw/koramangala.osm.pbf` (gitignored).

## Tests

```bash
pnpm test
```
