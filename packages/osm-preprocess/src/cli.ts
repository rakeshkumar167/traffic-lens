#!/usr/bin/env -S node --import tsx
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoundingBox } from '@traffic-lens/shared';
import { preprocess } from './run.ts';
import { emitRoadGraphJson } from './emit.ts';

interface Args {
  inPath: string;
  outPath: string;
  bbox: BoundingBox;
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue; // POSIX end-of-options separator — skip
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Missing value for ${a}`);
      }
      flags.set(a, next);
      i++;
    }
  }
  const required = (k: string): string => {
    const v = flags.get(k);
    if (v === undefined) throw new Error(`Missing required flag ${k}`);
    return v;
  };
  const parseBbox = (s: string): BoundingBox => {
    const parts = s.split(',').map((x) => Number.parseFloat(x.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`Invalid --bbox "${s}" (want "minLon,minLat,maxLon,maxLat")`);
    }
    const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
    return { minLon, minLat, maxLon, maxLat };
  };
  return {
    inPath: resolve(required('--in')),
    outPath: resolve(required('--out')),
    bbox: parseBbox(required('--bbox')),
  };
}

async function readScriptVersion(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, '..', 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scriptVersion = await readScriptVersion();
  const graph = await preprocess({
    inputPath: args.inPath,
    bbox: args.bbox,
    scriptVersion,
  });
  await mkdir(dirname(args.outPath), { recursive: true });
  await writeFile(args.outPath, emitRoadGraphJson(graph), 'utf8');
  const signalledCount = graph.junctions.filter((j) => j.kind === 'signalled').length;
  const priorityCount = graph.junctions.length - signalledCount;
  // Single-line summary that the test asserts against.
  process.stdout.write(
    `wrote ${args.outPath}: ${graph.edges.length} edges, ` +
      `${graph.junctions.length} junctions ` +
      `(${signalledCount} signalled, ${priorityCount} priority), ` +
      `${graph.boundaryEdges.length} boundary edges\n`,
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`preprocess failed: ${msg}\n`);
  process.exit(1);
});
