import { existsSync } from 'node:fs';
// @ts-expect-error — osm-read has no types
import osmread from 'osm-read';
import type { OsmNode, OsmWay, ParsedOsm } from './types.ts';
import { isDrivableHighwayValue } from './types.ts';

// Actual shapes from osm-read/lib/xmlParser.js:
//   node.id  — string (parseNOP); node.lat/lon — number (parseFloat)
//   way.id   — string (parseNOP); way.nodeRefs — string[] (raw attr values)
interface OsmReadNode {
  id: string;
  lon: number;
  lat: number;
  tags?: Record<string, string>;
}

interface OsmReadWay {
  id: string;
  nodeRefs: string[];
  tags?: Record<string, string>;
}

// Parse an OSM .osm (XML) file. Returns all nodes (since drivable ways
// reference them by id) but filters ways down to the drivable subset.
// Note: format must be supplied as 'xml' because osm-read only auto-detects
// '.xml' and '.pbf' extensions; '.osm' is not auto-recognised.
export async function parseOsmFile(filePath: string): Promise<ParsedOsm> {
  if (!existsSync(filePath)) {
    throw new Error(`OSM input file not found: ${filePath}`);
  }

  const nodes = new Map<number, OsmNode>();
  const drivableWays: OsmWay[] = [];

  await new Promise<void>((resolve, reject) => {
    osmread.parse({
      filePath,
      format: 'xml',
      node: (n: OsmReadNode) => {
        nodes.set(Number(n.id), {
          id: Number(n.id),
          lon: n.lon,
          lat: n.lat,
          tags: { ...(n.tags ?? {}) },
        });
      },
      way: (w: OsmReadWay) => {
        if (!isDrivableHighwayValue(w.tags?.['highway'])) return;
        drivableWays.push({
          id: Number(w.id),
          nodeRefs: w.nodeRefs.map(Number),
          tags: { ...(w.tags ?? {}) },
        });
      },
      relation: () => {
        // Relations are ignored in this slice.
      },
      endDocument: () => resolve(),
      error: (err: Error) => reject(err),
    });
  });

  return { nodes, drivableWays };
}
