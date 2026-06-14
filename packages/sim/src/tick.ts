import type { Edge, EdgeId, Junction, SignalledJunction } from '@traffic-lens/shared';
import { STATE_ACTIVE, SIGNAL_STOP_LINE_M } from '@traffic-lens/shared';
import { ROAD_CLASS_SPEED_MPS } from '@traffic-lens/shared';
import { idmAcceleration } from './idm.ts';
import { advanceSignalState, isEdgeGreen } from './signals.ts';
import { canEnterPriorityJunction } from './priority.ts';
import { TICK_DT, type World } from './world.ts';

const BRAKING_LOOKAHEAD_M = 50;

export function tick(world: World): void {
  // 1. Signals
  for (const [jid, state] of world.signalStates) {
    const plan = world.signalPlans.get(jid)!.defaultSignalPlan;
    advanceSignalState(state, plan, TICK_DT);
  }

  // 2. Spawn
  world.spawnController.step(TICK_DT, world.store);

  // 3. Perception index rebuild
  world.perception.rebuild(world.store, world.edgesById);

  // 4-7. Per-vehicle decision + integrate
  const v = world.views;
  world.store.forEachActive((i) => {
    const edge = world.edgesById.get(v.edgeId[i]!)!;
    const v0 = ROAD_CLASS_SPEED_MPS[edge.roadClass];
    const leader = world.perception.findLeader(v.edgeId[i]!, v.lane[i]!, v.edgeProgress[i]!);
    let leaderSpeed = 0;
    let gap = Infinity;
    if (leader) {
      leaderSpeed = v.speed[leader.slotIdx]!;
      gap = leader.gapM;
    }

    // Virtual leader for intersection control.
    const distToJunction = (1 - v.edgeProgress[i]!) * edge.lengthM;
    if (distToJunction < BRAKING_LOOKAHEAD_M) {
      const junction = world.junctionsById.get(edge.toJunction);
      if (junction) {
        const virt = virtualLeaderFor(world, junction, edge, v.edgeId[i]!, distToJunction, v.speed[i]!);
        if (virt !== null && virt < gap) {
          gap = virt;
          leaderSpeed = 0;
        }
      }
    }

    const accel = idmAcceleration({
      speed: v.speed[i]!,
      leaderSpeed,
      gap,
      v0,
      params: world.idmParams,
    });
    v.accel[i] = accel;
    const newSpeed = Math.max(0, v.speed[i]! + accel * TICK_DT);
    v.speed[i] = newSpeed;

    // Integrate position along the polyline.
    const dProgress = (newSpeed * TICK_DT) / edge.lengthM;
    let progress = v.edgeProgress[i]! + dProgress;

    if (progress >= 1) {
      // Advance to next route edge.
      const route = world.store.getRoute(i)!;
      const nextRouteIdx = v.routeIdx[i]! + 1;
      if (nextRouteIdx >= route.length) {
        world.store.despawn(i);
        return;
      }
      const carry = (progress - 1) * edge.lengthM;
      const nextEdgeId = route[nextRouteIdx]!;
      const nextEdge = world.edgesById.get(nextEdgeId)!;
      v.edgeId[i] = nextEdgeId;
      v.routeIdx[i] = nextRouteIdx;
      v.lane[i] = Math.min(v.lane[i]!, nextEdge.lanes - 1);
      progress = Math.min(0.99, carry / nextEdge.lengthM);
      v.edgeProgress[i] = progress;
      writePos(v, i, nextEdge, progress);
    } else {
      v.edgeProgress[i] = progress;
      writePos(v, i, edge, progress);
    }
    v.state[i] = STATE_ACTIVE;
  });

  // 8-9. Update control region.
  v.control.tickNumber[0]! += 1;
  v.control.simWallClockSec[0]! += TICK_DT;
}

function writePos(v: World['views'], i: number, edge: Edge, progress: number): void {
  // Linear interpolation along the polyline based on cumulative segment lengths.
  // For Plan B we approximate by lerping start→end (the geometry is a polyline
  // but the cumulative arc-length form is a deferred optimization).
  const a = edge.geometry[0]!;
  const b = edge.geometry[edge.geometry.length - 1]!;
  const t = progress;
  v.posX[i] = a.x + (b.x - a.x) * t;
  v.posY[i] = a.y + (b.y - a.y) * t;
  v.heading[i] = Math.atan2(b.y - a.y, b.x - a.x);
}

function virtualLeaderFor(
  world: World,
  junction: Junction,
  _incomingEdge: Edge,
  incomingEdgeId: EdgeId,
  distToJunction: number,
  selfSpeed: number,
): number | null {
  if (junction.kind === 'signalled') {
    const plan = (junction as SignalledJunction).defaultSignalPlan;
    const state = world.signalStates.get(junction.id);
    if (!state) return null;
    if (isEdgeGreen(state, plan, incomingEdgeId)) return null;
    // Stop at the stop line a few metres before the junction (where the red
    // signal is drawn), not at the junction node itself.
    return Math.max(0, distToJunction - SIGNAL_STOP_LINE_M);
  }
  // priority junction
  const priorityEdges = new Set(junction.priorityEdges);
  if (priorityEdges.has(incomingEdgeId)) return null;
  if (priorityEdges.size === 0) return null;
  // Collect priority approaches: vehicles currently traversing any priority edge,
  // ordered by their own distance to the junction.
  const approaches: { distanceToJunction: number; speed: number }[] = [];
  const v = world.views;
  for (const pEdgeId of priorityEdges) {
    const pEdge = world.edgesById.get(pEdgeId);
    if (!pEdge) continue;
    world.store.forEachActive((idx) => {
      if (v.edgeId[idx] !== pEdgeId) return;
      const d = (1 - v.edgeProgress[idx]!) * pEdge.lengthM;
      approaches.push({ distanceToJunction: d, speed: v.speed[idx]! });
    });
  }
  const ok = canEnterPriorityJunction({
    selfDistanceToJunction: distToJunction,
    selfSpeed,
    priorityApproaches: approaches,
    params: world.priorityParams,
  });
  return ok ? null : distToJunction;
}
