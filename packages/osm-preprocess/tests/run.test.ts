import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { preprocess, emitRoadGraphJson } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const TINY_FIXTURE = join(here, 'fixtures', 'tiny.osm');
const SNAPSHOT_PATH = join(here, 'snapshots', 'tiny.graph.json');

describe('end-to-end preprocess (tiny.osm)', () => {
  it('matches the committed graph snapshot', async () => {
    const graph = await preprocess({
      inputPath: TINY_FIXTURE,
      bbox: { minLon: 77.619, minLat: 12.929, maxLon: 77.631, maxLat: 12.946 },
      scriptVersion: '0.0.0',
      generatedAt: '2026-06-12T00:00:00.000Z',
    });
    const json = emitRoadGraphJson(graph);
    await expect(json).toMatchFileSnapshot(SNAPSHOT_PATH);
  });

  it('is deterministic across runs', async () => {
    const a = await preprocess({
      inputPath: TINY_FIXTURE,
      bbox: { minLon: 77.619, minLat: 12.929, maxLon: 77.631, maxLat: 12.946 },
      scriptVersion: '0.0.0',
      generatedAt: '2026-06-12T00:00:00.000Z',
    });
    const b = await preprocess({
      inputPath: TINY_FIXTURE,
      bbox: { minLon: 77.619, minLat: 12.929, maxLon: 77.631, maxLat: 12.946 },
      scriptVersion: '0.0.0',
      generatedAt: '2026-06-12T00:00:00.000Z',
    });
    expect(emitRoadGraphJson(a)).toBe(emitRoadGraphJson(b));
  });
});
