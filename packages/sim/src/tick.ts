import type { Edge, EdgeId, Junction, SignalledJunction } from '@traffic-lens/shared';
import { STATE_ACTIVE, SIGNAL_STOP_LINE_M, VEHICLE_LENGTH_M } from '@traffic-lens/shared';
import { ROAD_CLASS_SPEED_MPS } from '@traffic-lens/shared';
import { idmAcceleration } from './idm.ts';
import { advanceSignalState, isEdgeGreen } from './signals.ts';
import { canEnterPriorityJunction } from './priority.ts';
import { interpolateAlong, type PointHeading } from './geometry.ts';
import { TICK_DT, type World } from './world.ts';

const BRAKING_LOOKAHEAD_M = 50;

// Scratch object reused across writePos calls to avoid per-vehicle allocation.
const SCRATCH_POINT: PointHeading = { x: 0, y: 0, heading: 0 };

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
    // A car that has passed its stop point at a signalled junction is committed
    // into the crossing: it must clear it, so it ignores the signal and any
    // downstream queue. (It still follows the car directly ahead via the
    // same-edge leader above, so it can't overlap.) Without this a car caught in
    // the box by a green→red flip, or a downstream jam, would freeze mid-junction
    // and block cross traffic. Only signalled approaches have a stop distance;
    // priority junctions keep their normal yielding behaviour.
    const stopDist = world.edgeStopDist.get(v.edgeId[i]!);
    const committed = stopDist !== undefined && distToJunction < stopDist;
    if (!committed && distToJunction < BRAKING_LOOKAHEAD_M) {
      const junction = world.junctionsById.get(edge.toJunction);
      if (junction) {
        const virt = virtualLeaderFor(world, junction, edge, v.edgeId[i]!, distToJunction, v.speed[i]!);
        if (virt !== null && virt < gap) {
          gap = virt;
          leaderSpeed = 0;
        }
      }

      // Cross-edge spillback: a leader on this edge stops at progress 1, so a
      // queue that has filled the next route edge is invisible to the per-edge
      // leader search. Treat the trailing (lowest-progress) car on the next edge
      // as a leader, with the gap spanning the rest of this edge plus its
      // position into the next one. Without this, cars drive into the junction
      // and overlap the queue tail.
      const route = world.store.getRoute(i);
      if (route) {
        const nextRouteIdx = v.routeIdx[i]! + 1;
        if (nextRouteIdx < route.length) {
          const nextEdge = world.edgesById.get(route[nextRouteIdx]!);
          if (nextEdge) {
            const enterLane = Math.min(v.lane[i]!, nextEdge.lanes - 1);
            const trailing = world.perception.findTrailing(nextEdge.id, enterLane);
            if (trailing) {
              const crossGap = distToJunction + trailing.progress * nextEdge.lengthM - VEHICLE_LENGTH_M;
              if (crossGap < gap) {
                gap = Math.max(0, crossGap);
                leaderSpeed = v.speed[trailing.slotIdx]!;
              }
            }
          }
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

    // Hard stop-line constraint: a car that hasn't reached the stop line must not
    // roll past it while its signal is red — even if IDM braking alone couldn't
    // have stopped it in time (a fast car caught by a green→red change). This is
    // what keeps the junction box clear so cross traffic isn't blocked. A car
    // already past the line when the light changes is let through to clear the
    // junction rather than freezing in the middle of it.
    const stopProg = redSignalStopLineProgress(world, edge, v.edgeId[i]!);
    if (stopProg !== null && v.edgeProgress[i]! <= stopProg && progress > stopProg) {
      progress = stopProg;
      v.speed[i] = 0;
      v.accel[i] = 0;
    }

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
      writePos(world, v, i, nextEdge, progress);
    } else {
      v.edgeProgress[i] = progress;
      writePos(world, v, i, edge, progress);
    }
    v.state[i] = STATE_ACTIVE;
  });

  // 8-9. Update control region.
  v.control.tickNumber[0]! += 1;
  v.control.simWallClockSec[0]! += TICK_DT;
}

// Progress (0..1) of the stop line on an edge whose downstream junction is a
// signal currently showing red/amber for this approach. null if the junction is
// not a red signal (green, priority, or unsignalled), meaning no hard stop.
function redSignalStopLineProgress(world: World, edge: Edge, edgeId: EdgeId): number | null {
  const junction = world.junctionsById.get(edge.toJunction);
  if (!junction || junction.kind !== 'signalled') return null;
  const plan = (junction as SignalledJunction).defaultSignalPlan;
  const state = world.signalStates.get(junction.id);
  if (!state) return null;
  if (isEdgeGreen(state, plan, edgeId)) return null;
  const stop = world.edgeStopDist.get(edgeId) ?? SIGNAL_STOP_LINE_M;
  if (edge.lengthM <= stop) return 0;
  return 1 - stop / edge.lengthM;
}

function writePos(world: World, v: World['views'], i: number, edge: Edge, progress: number): void {
  // Place the vehicle along the actual edge polyline by arc length. Falls back to
  // the straight chord only if an edge somehow has no precomputed polyline.
  const poly = world.edgePolylines.get(edge.id);
  if (poly) {
    interpolateAlong(edge, poly, progress, SCRATCH_POINT);
    v.posX[i] = SCRATCH_POINT.x;
    v.posY[i] = SCRATCH_POINT.y;
    v.heading[i] = SCRATCH_POINT.heading;
    return;
  }
  const a = edge.geometry[0]!;
  const b = edge.geometry[edge.geometry.length - 1]!;
  v.posX[i] = a.x + (b.x - a.x) * progress;
  v.posY[i] = a.y + (b.y - a.y) * progress;
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
    // Brake to a point just behind the junction box (front bumper one metre back),
    // not the junction node itself, so the car never enters the crossing.
    const stop = world.edgeStopDist.get(incomingEdgeId) ?? SIGNAL_STOP_LINE_M;
    return Math.max(0, distToJunction - stop);
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
