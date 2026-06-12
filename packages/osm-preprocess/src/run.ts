import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { BoundingBox, RoadGraph } from '@traffic-lens/shared';
import { parseOsmFile } from './parse.ts';
import { buildEdges } from './graph.ts';
import { buildJunctions } from './junctions.ts';
import { findBoundaryEdges } from './boundary.ts';
import { validateRoadGraph } from './validate.ts';
import { pruneToLargestComponent } from './largest-component.ts';

export interface PreprocessOptions {
  readonly inputPath: string;
  readonly bbox: BoundingBox;
  readonly scriptVersion: string;
  // Override the timestamp for deterministic snapshot tests.
  readonly generatedAt?: string;
}

export interface PreprocessResult {
  readonly graph: RoadGraph;
  readonly droppedJunctionCount: number;
  readonly droppedEdgeCount: number;
}

export async function preprocess(opts: PreprocessOptions): Promise<PreprocessResult> {
  const parsed = await parseOsmFile(opts.inputPath);
  const { edges: rawEdges, junctionNodeIds } = buildEdges(parsed);
  const rawJunctions = buildJunctions(parsed, rawEdges, junctionNodeIds);
  const pruned = pruneToLargestComponent(rawEdges, rawJunctions);
  const boundaryEdges = findBoundaryEdges(pruned.edges, pruned.junctions);
  const sourceHash = await sha256OfFile(opts.inputPath);

  const graph: RoadGraph = {
    meta: {
      bbox: opts.bbox,
      projection: 'webMercator',
      generatedAt: opts.generatedAt ?? new Date().toISOString(),
      sourceHash,
      scriptVersion: opts.scriptVersion,
    },
    edges: pruned.edges,
    junctions: pruned.junctions,
    boundaryEdges,
  };

  validateRoadGraph(graph);
  return {
    graph,
    droppedJunctionCount: pruned.droppedJunctionCount,
    droppedEdgeCount: pruned.droppedEdgeCount,
  };
}

async function sha256OfFile(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}
