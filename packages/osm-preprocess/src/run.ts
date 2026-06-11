import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { BoundingBox, RoadGraph } from '@traffic-lens/shared';
import { parseOsmFile } from './parse.ts';
import { buildEdges } from './graph.ts';
import { buildJunctions } from './junctions.ts';
import { findBoundaryEdges } from './boundary.ts';
import { validateRoadGraph } from './validate.ts';

export interface PreprocessOptions {
  readonly inputPath: string;
  readonly bbox: BoundingBox;
  readonly scriptVersion: string;
  // Override the timestamp for deterministic snapshot tests.
  readonly generatedAt?: string;
}

export async function preprocess(opts: PreprocessOptions): Promise<RoadGraph> {
  const parsed = await parseOsmFile(opts.inputPath);
  const { edges, junctionNodeIds } = buildEdges(parsed);
  const junctions = buildJunctions(parsed, edges, junctionNodeIds);
  const boundaryEdges = findBoundaryEdges(edges, junctions);
  const sourceHash = await sha256OfFile(opts.inputPath);

  const graph: RoadGraph = {
    meta: {
      bbox: opts.bbox,
      projection: 'webMercator',
      generatedAt: opts.generatedAt ?? new Date().toISOString(),
      sourceHash,
      scriptVersion: opts.scriptVersion,
    },
    edges,
    junctions,
    boundaryEdges,
  };

  validateRoadGraph(graph);
  return graph;
}

async function sha256OfFile(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}
