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

function detectFormat(filePath: string): 'xml' | 'pbf' {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.pbf')) return 'pbf';
  if (lower.endsWith('.osm') || lower.endsWith('.xml')) return 'xml';
  throw new Error(`Unsupported OSM file extension: ${filePath}`);
}

// Parse an OSM file (XML or PBF format). Returns all nodes (since drivable ways
// reference them by id) but filters ways down to the drivable subset.
// Detects format automatically from file extension (.osm/.xml → XML, .pbf → PBF).
export async function parseOsmFile(filePath: string): Promise<ParsedOsm> {
  const format = detectFormat(filePath);

  if (!existsSync(filePath)) {
    throw new Error(`OSM input file not found: ${filePath}`);
  }

  const nodes = new Map<number, OsmNode>();
  const drivableWays: OsmWay[] = [];

  await new Promise<void>((resolve, reject) => {
    osmread.parse({
      filePath,
      format,
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
