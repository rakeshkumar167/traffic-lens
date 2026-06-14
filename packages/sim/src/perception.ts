import type { Edge, EdgeId } from '@traffic-lens/shared';
import { VEHICLE_LENGTH_M } from '@traffic-lens/shared';
import type { VehicleStore } from './vehicle-store.ts';

interface EdgeBucket {
  slotIdx: number[];      // parallel arrays sorted by progress ascending
  progress: number[];
  lane: number[];
}

export interface LeaderResult {
  slotIdx: number;
  gapM: number;
}

export interface TrailingResult {
  slotIdx: number;
  progress: number;
}

export class PerceptionIndex {
  private buckets = new Map<EdgeId, EdgeBucket>();
  private edgesRef: ReadonlyMap<EdgeId, Edge> = new Map();

  rebuild(store: VehicleStore, edges: ReadonlyMap<EdgeId, Edge>): void {
    // Reset (preserving allocation for hot reuse).
    for (const bucket of this.buckets.values()) {
      bucket.slotIdx.length = 0;
      bucket.progress.length = 0;
      bucket.lane.length = 0;
    }
    const v = store.views;
    store.forEachActive((idx) => {
      const eid = v.edgeId[idx]!;
      let bucket = this.buckets.get(eid);
      if (!bucket) {
        bucket = { slotIdx: [], progress: [], lane: [] };
        this.buckets.set(eid, bucket);
      }
      bucket.slotIdx.push(idx);
      bucket.progress.push(v.edgeProgress[idx]!);
      bucket.lane.push(v.lane[idx]!);
    });
    // Sort each bucket by progress ascending. We need a co-sort across the
    // three parallel arrays, so build index permutation then apply it.
    for (const bucket of this.buckets.values()) {
      if (bucket.slotIdx.length < 2) continue;
      const perm = bucket.slotIdx.map((_, i) => i);
      perm.sort((a, b) => bucket.progress[a]! - bucket.progress[b]!);
      const newSlot = perm.map((i) => bucket.slotIdx[i]!);
      const newProg = perm.map((i) => bucket.progress[i]!);
      const newLane = perm.map((i) => bucket.lane[i]!);
      bucket.slotIdx = newSlot;
      bucket.progress = newProg;
      bucket.lane = newLane;
    }
    this.edgesRef = edges;
  }

  findLeader(edgeId: EdgeId, lane: number, progress: number): LeaderResult | null {
    const bucket = this.buckets.get(edgeId);
    const edge = this.edgesRef.get(edgeId);
    if (!bucket || !edge) return null;
    // Normalise to Float32 so comparisons match values read from the SAB
    // (edgeProgress is stored as Float32; passing a Float64 literal like 0.2
    // would be slightly smaller than the stored Float32 representation).
    const _tmp = new Float32Array(1);
    _tmp[0] = progress;
    const progressF32 = _tmp[0];
    // Linear scan from first entry with progress > self.progress (binary search
    // would be an optimization but with <50 vehicles per edge the constants
    // dominate; revisit only if profiling demands it).
    let bestIdx = -1;
    let bestProg = Infinity;
    for (let i = 0; i < bucket.slotIdx.length; i++) {
      const p = bucket.progress[i]!;
      if (p <= progressF32) continue;
      if (bucket.lane[i] !== lane) continue;
      if (p < bestProg) {
        bestProg = p;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return null;
    return {
      slotIdx: bucket.slotIdx[bestIdx]!,
      // Positions are vehicle centres, so subtract one vehicle length to get the
      // bumper-to-bumper gap IDM expects. Clamp at 0 so an overlap (e.g. a car
      // that just crossed onto a packed edge) reads as a hard stop, not a
      // negative gap.
      gapM: Math.max(0, (bestProg - progressF32) * edge.lengthM - VEHICLE_LENGTH_M),
    };
  }

  // The trailing (lowest-progress) vehicle in a lane — i.e. the last car of a
  // queue, closest to the edge's entry. Used for cross-edge spillback braking so
  // a car entering this edge from upstream sees the queue tail. Buckets are
  // sorted by progress ascending, so the first lane match is the trailing one.
  findTrailing(edgeId: EdgeId, lane: number): TrailingResult | null {
    const bucket = this.buckets.get(edgeId);
    if (!bucket) return null;
    for (let i = 0; i < bucket.slotIdx.length; i++) {
      if (bucket.lane[i] === lane) {
        return { slotIdx: bucket.slotIdx[i]!, progress: bucket.progress[i]! };
      }
    }
    return null;
  }
}
