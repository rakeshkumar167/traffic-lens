import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(here, '..', 'src', 'cli.ts');
const FIXTURE_SRC = join(here, 'fixtures', 'tiny.osm');

describe('cli', () => {
  let outPath: string;
  let inPath: string;

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'traffic-lens-cli-'));
    inPath = join(dir, 'tiny.osm');
    outPath = join(dir, 'tiny.graph.json');
    await copyFile(FIXTURE_SRC, inPath);
  });

  it('runs end-to-end against the fixture', async () => {
    const { stdout } = await execFileAsync('pnpm', [
      'exec', 'tsx', CLI_PATH,
      '--in', inPath,
      '--out', outPath,
      '--bbox', '77.619,12.929,77.631,12.946',
    ]);
    expect(stdout).toMatch(/8 edges/);
    expect(stdout).toMatch(/6 junctions/);
    const json = JSON.parse(await readFile(outPath, 'utf8'));
    expect(json.edges.length).toBe(8);
    expect(json.junctions.length).toBe(6);
  }, 30_000);

  it('exits non-zero when --in file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'traffic-lens-cli-bad-'));
    await mkdir(dir, { recursive: true });
    await expect(
      execFileAsync('pnpm', [
        'exec', 'tsx', CLI_PATH,
        '--in', join(dir, 'no-such-file.osm'),
        '--out', join(dir, 'out.json'),
        '--bbox', '0,0,1,1',
      ]),
    ).rejects.toThrow();
  }, 30_000);
});
