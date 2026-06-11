import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseOsmFile } from '../src/parse.ts';

const here = dirname(fileURLToPath(import.meta.url));
const TINY_FIXTURE = join(here, 'fixtures', 'tiny.osm');

describe('parseOsmFile (tiny.osm fixture)', () => {
  it('returns all 6 nodes', async () => {
    const { nodes } = await parseOsmFile(TINY_FIXTURE);
    expect(nodes.size).toBe(6);
    const node3 = nodes.get(3);
    expect(node3).toBeDefined();
    expect(node3?.tags['highway']).toBe('traffic_signals');
  });

  it('returns only the 3 drivable ways', async () => {
    const { drivableWays } = await parseOsmFile(TINY_FIXTURE);
    const ids = drivableWays.map((w) => w.id).sort();
    expect(ids).toEqual([100, 101, 102]);
  });

  it('preserves way tags', async () => {
    const { drivableWays } = await parseOsmFile(TINY_FIXTURE);
    const way101 = drivableWays.find((w) => w.id === 101);
    expect(way101?.tags['highway']).toBe('secondary');
    expect(way101?.tags['oneway']).toBe('yes');
    expect(way101?.tags['lanes']).toBe('3');
  });

  it('throws if the file does not exist', async () => {
    await expect(parseOsmFile('/no/such/file.osm')).rejects.toThrow();
  });

  it('throws on an unsupported extension', async () => {
    await expect(parseOsmFile('/tmp/whatever.txt')).rejects.toThrow(
      /Unsupported OSM file extension/,
    );
  });
});
