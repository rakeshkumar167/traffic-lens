import type { Edge, EdgeId, JunctionId, RoadGraph } from '@traffic-lens/shared';
import { ROAD_CLASS_SPEED_MPS } from '@traffic-lens/shared';

const MAX_SPEED_MPS = Math.max(...Object.values(ROAD_CLASS_SPEED_MPS));

interface OpenEntry {
  edgeId: EdgeId;
  gCost: number;
  fCost: number;
}

export class Router {
  private readonly edgeById = new Map<EdgeId, Edge>();
  private readonly outgoingByJunction = new Map<JunctionId, EdgeId[]>();
  private readonly cache = new Map<string, EdgeId[] | null>();

  constructor(graph: RoadGraph) {
    for (const e of graph.edges) {
      this.edgeById.set(e.id, e);
      const list = this.outgoingByJunction.get(e.fromJunction);
      if (list) list.push(e.id);
      else this.outgoingByJunction.set(e.fromJunction, [e.id]);
    }
  }

  findRoute(spawnEdgeId: EdgeId, exitEdgeId: EdgeId): EdgeId[] | null {
    const key = `${spawnEdgeId}->${exitEdgeId}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const result = this.aStar(spawnEdgeId, exitEdgeId);
    this.cache.set(key, result);
    return result;
  }

  private aStar(spawnEdgeId: EdgeId, exitEdgeId: EdgeId): EdgeId[] | null {
    const start = this.edgeById.get(spawnEdgeId);
    const goal = this.edgeById.get(exitEdgeId);
    if (!start || !goal) return null;
    if (spawnEdgeId === exitEdgeId) return [spawnEdgeId];

    const cameFrom = new Map<EdgeId, EdgeId>();
    const gScore = new Map<EdgeId, number>();
    gScore.set(spawnEdgeId, 0);

    // Open list as a min-heap-by-fCost would be ideal; for ≤5121 edges a plain
    // array + linear scan is acceptable. We can swap in a heap later if profiling shows need.
    const open: OpenEntry[] = [{
      edgeId: spawnEdgeId,
      gCost: 0,
      fCost: this.heuristic(start, goal),
    }];
    const inOpen = new Set<EdgeId>([spawnEdgeId]);
    const closed = new Set<EdgeId>();

    while (open.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i]!.fCost < open[bestIdx]!.fCost) bestIdx = i;
      }
      const current = open.splice(bestIdx, 1)[0]!;
      inOpen.delete(current.edgeId);
      if (current.edgeId === exitEdgeId) {
        return reconstructPath(cameFrom, exitEdgeId);
      }
      closed.add(current.edgeId);

      const currentEdge = this.edgeById.get(current.edgeId)!;
      const successors = this.outgoingByJunction.get(currentEdge.toJunction) ?? [];
      const stepCost = currentEdge.lengthM / ROAD_CLASS_SPEED_MPS[currentEdge.roadClass];
      for (const nextId of successors) {
        if (closed.has(nextId)) continue;
        const tentativeG = current.gCost + stepCost;
        const prevG = gScore.get(nextId) ?? Infinity;
        if (tentativeG >= prevG) continue;
        cameFrom.set(nextId, current.edgeId);
        gScore.set(nextId, tentativeG);
        const nextEdge = this.edgeById.get(nextId)!;
        const fCost = tentativeG + this.heuristic(nextEdge, goal);
        if (inOpen.has(nextId)) {
          for (const entry of open) {
            if (entry.edgeId === nextId) {
              entry.gCost = tentativeG;
              entry.fCost = fCost;
              break;
            }
          }
        } else {
          open.push({ edgeId: nextId, gCost: tentativeG, fCost });
          inOpen.add(nextId);
        }
      }
    }
    return null;
  }

  private heuristic(from: Edge, goal: Edge): number {
    const a = from.geometry[from.geometry.length - 1]!;
    const b = goal.geometry[0]!;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy) / MAX_SPEED_MPS;
  }
}

function reconstructPath(cameFrom: Map<EdgeId, EdgeId>, goal: EdgeId): EdgeId[] {
  const path: EdgeId[] = [goal];
  let cur: EdgeId | undefined = goal;
  while (cur !== undefined && cameFrom.has(cur)) {
    cur = cameFrom.get(cur);
    if (cur !== undefined) path.push(cur);
  }
  return path.reverse();
}
