import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseOsmFile } from '../src/parse.ts';
import { buildEdges } from '../src/graph.ts';
import { buildJunctions } from '../src/junctions.ts';

const here = dirname(fileURLToPath(import.meta.url));
const TINY_FIXTURE = join(here, 'fixtures', 'tiny.osm');

describe('buildJunctions (tiny.osm fixture)', () => {
  it('produces 6 junctions (one per OSM node)', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    expect(junctions.length).toBe(6);
  });

  it('classifies node 3 as signalled (has traffic_signals tag)', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    const j3 = junctions.find((j) => j.id === 3);
    expect(j3?.kind).toBe('signalled');
  });

  it('classifies node 2 as priority (no signal tag, multi-way junction)', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    const j2 = junctions.find((j) => j.id === 2);
    expect(j2?.kind).toBe('priority');
  });

  it('classifies all boundary-endpoint nodes as priority', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    for (const id of [1, 4, 5, 6]) {
      expect(junctions.find((j) => j.id === id)?.kind).toBe('priority');
    }
  });

  it('priority junction at node 2 ranks primary above secondary', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    const j2 = junctions.find((j) => j.id === 2);
    expect(j2?.kind).toBe('priority');
    if (j2?.kind !== 'priority') throw new Error('unreachable');
    // The primary edges (from/to node 1 and node 4) should be in priorityEdges.
    // The secondary edge from node 2 toward node 3 should not be.
    const primaryIncoming = edges.filter(
      (e) => e.toJunction === 2 && e.roadClass === 'primary',
    );
    expect(primaryIncoming.length).toBeGreaterThan(0);
    expect(j2.priorityEdges).toEqual(
      expect.arrayContaining(primaryIncoming.map((e) => e.id)),
    );
    const secondaryOutgoing = edges.filter(
      (e) => e.fromJunction === 2 && e.roadClass === 'secondary',
    );
    expect(secondaryOutgoing.length).toBeGreaterThan(0);
    for (const e of secondaryOutgoing) {
      expect(j2.priorityEdges).not.toContain(e.id);
    }
  });

  it('signal junction has a default signal plan with non-zero cycle', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    const j3 = junctions.find((j) => j.id === 3);
    if (j3?.kind !== 'signalled') throw new Error('expected signalled');
    expect(j3.defaultSignalPlan.cycleSec).toBeGreaterThan(0);
    expect(j3.defaultSignalPlan.phases.length).toBeGreaterThanOrEqual(1);
  });

  it('builds connection table covering every incoming→outgoing pair', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    for (const j of junctions) {
      for (const inEdgeId of j.incomingEdges) {
        for (const outEdgeId of j.outgoingEdges) {
          // U-turn connections (going back the way you came) may be excluded;
          // every other pair must appear.
          const inEdge = edges.find((e) => e.id === inEdgeId)!;
          const outEdge = edges.find((e) => e.id === outEdgeId)!;
          const isUTurn = inEdge.fromJunction === outEdge.toJunction
            && inEdge.toJunction === outEdge.fromJunction;
          if (isUTurn) continue;
          const conn = j.connections.find(
            (c) => c.fromEdge === inEdgeId && c.toEdge === outEdgeId,
          );
          expect(conn).toBeDefined();
        }
      }
    }
  });
});
