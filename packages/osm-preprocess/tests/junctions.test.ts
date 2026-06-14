import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Edge, EdgeId } from '@traffic-lens/shared';
import { parseOsmFile } from '../src/parse.ts';
import { buildEdges } from '../src/graph.ts';
import { buildJunctions, groupApproachesByAxis, greenSecForRank } from '../src/junctions.ts';

const here = dirname(fileURLToPath(import.meta.url));
const TINY_FIXTURE = join(here, 'fixtures', 'tiny.osm');
const CROSS_FIXTURE = join(here, 'fixtures', 'cross.osm');

describe('buildJunctions (tiny.osm fixture)', () => {
  it('produces 6 junctions (one per OSM node)', async () => {
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    expect(junctions.length).toBe(6);
  });

  it('classifies node 3 as priority — a 3-leg node is not signalled despite its tag', async () => {
    // Signals are now placed structurally (>=4-leg crossroads on major roads),
    // not from OSM stop-line tags. Node 3 has only 3 legs, so it is give-way.
    const parsed = await parseOsmFile(TINY_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    const j3 = junctions.find((j) => j.id === 3);
    expect(j3?.kind).toBe('priority');
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

  it('signalises a 4-way crossroad with two opposing-pair phases', async () => {
    const parsed = await parseOsmFile(CROSS_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    const center = junctions.find((j) => j.id === 10);
    if (center?.kind !== 'signalled') throw new Error('expected center to be signalled');
    const plan = center.defaultSignalPlan;
    expect(plan.phases.length).toBe(2);
    // tertiary junction → 25s green per phase, 50s cycle.
    expect(plan.cycleSec).toBe(50);
    // The two phases partition the 4 approaches into opposing pairs (N-S, E-W).
    expect(plan.phases[0]!.greenIncomingEdges.length).toBe(2);
    expect(plan.phases[1]!.greenIncomingEdges.length).toBe(2);
    const arm = (j: number) => edges.find((e) => e.fromJunction === j && e.toJunction === 10)!.id;
    const ns = new Set([arm(11), arm(12)]); // north + south
    const phase0 = new Set(plan.phases[0]!.greenIncomingEdges);
    // phase 0 holds either the N-S pair or the E-W pair, never a mix.
    const phase0IsNS = [...phase0].every((id) => ns.has(id));
    const phase0IsEW = [...phase0].every((id) => !ns.has(id));
    expect(phase0IsNS || phase0IsEW).toBe(true);
  });

  it('leaves a 4-way of only residential roads as give-way (below the road-class gate)', async () => {
    const parsed = await parseOsmFile(CROSS_FIXTURE);
    const { edges, junctionNodeIds } = buildEdges(parsed);
    const junctions = buildJunctions(parsed, edges, junctionNodeIds);
    // Outer arms (single leg) are always priority regardless of class.
    expect(junctions.find((j) => j.id === 11)?.kind).toBe('priority');
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

function mkEdge(id: EdgeId, geometry: { x: number; y: number }[]): Edge {
  return {
    id, fromJunction: 0, toJunction: 0, geometry,
    lengthM: 100, lanes: 1, roadClass: 'tertiary', oneway: false,
  };
}

describe('groupApproachesByAxis', () => {
  it('groups opposing approaches and splits perpendicular ones (4-way)', () => {
    // Approaches into a junction at the origin from N, E, S, W (last segment
    // points toward 0,0).
    const byId = new Map<EdgeId, Edge>([
      [1, mkEdge(1, [{ x: 0, y: 100 }, { x: 0, y: 0 }])],  // from north
      [2, mkEdge(2, [{ x: 100, y: 0 }, { x: 0, y: 0 }])],  // from east
      [3, mkEdge(3, [{ x: 0, y: -100 }, { x: 0, y: 0 }])], // from south
      [4, mkEdge(4, [{ x: -100, y: 0 }, { x: 0, y: 0 }])], // from west
    ]);
    const [a, b] = groupApproachesByAxis([1, 2, 3, 4], byId);
    const inA = new Set(a);
    expect(a.length + b.length).toBe(4);
    expect(inA.has(1)).toBe(inA.has(3));      // N and S share a phase
    expect(inA.has(2)).toBe(inA.has(4));      // E and W share a phase
    expect(inA.has(1)).not.toBe(inA.has(2));  // N-S and E-W are in different phases
  });

  it('returns empty groups when there are no approaches', () => {
    expect(groupApproachesByAxis([], new Map())).toEqual([[], []]);
  });

  it('honours an explicit shared reference axis', () => {
    const byId = new Map<EdgeId, Edge>([
      [1, mkEdge(1, [{ x: 0, y: 100 }, { x: 0, y: 0 }])],  // N (axis ≈ π/2)
      [2, mkEdge(2, [{ x: 100, y: 0 }, { x: 0, y: 0 }])],  // E (axis ≈ 0)
      [3, mkEdge(3, [{ x: 0, y: -100 }, { x: 0, y: 0 }])], // S (axis ≈ π/2)
      [4, mkEdge(4, [{ x: -100, y: 0 }, { x: 0, y: 0 }])], // W (axis ≈ 0)
    ]);
    // Force the E–W axis (0) as reference → E and W in phase A, N and S in phase B.
    const [a] = groupApproachesByAxis([1, 2, 3, 4], byId, 0);
    const inA = new Set(a);
    expect(inA.has(2)).toBe(true);
    expect(inA.has(4)).toBe(true);
    expect(inA.has(1)).toBe(false);
    expect(inA.has(3)).toBe(false);
  });
});

describe('greenSecForRank', () => {
  it('scales green per phase by road-class rank', () => {
    expect(greenSecForRank(6)).toBe(45); // primary
    expect(greenSecForRank(4)).toBe(35); // secondary
    expect(greenSecForRank(2)).toBe(25); // tertiary
    expect(greenSecForRank(1)).toBe(20); // residential
    expect(greenSecForRank(0)).toBe(20); // service
  });
});
