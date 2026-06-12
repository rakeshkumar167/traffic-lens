import type { EdgeId } from './road-graph.ts';

export interface DemandDestination {
  readonly exitEdgeId: EdgeId;
  readonly weight: number;
}

export interface DemandSource {
  readonly id: string;
  readonly spawnEdgeId: EdgeId;
  readonly vehiclesPerHour: number;
  readonly destinations: readonly DemandDestination[];
}

export interface Demand {
  readonly seed: number;
  readonly durationSec: number;
  readonly sources: readonly DemandSource[];
}

export function validateDemand(d: Demand): void {
  const errors: string[] = [];
  if (!Number.isFinite(d.seed)) errors.push('seed must be a finite number');
  if (!(d.durationSec > 0)) errors.push('durationSec must be positive');
  if (d.sources.length === 0) errors.push('demand must have at least one source');
  const sourceIds = new Set<string>();
  for (const src of d.sources) {
    if (sourceIds.has(src.id)) errors.push(`duplicate source id "${src.id}"`);
    sourceIds.add(src.id);
    if (!(src.vehiclesPerHour > 0)) {
      errors.push(`source "${src.id}" vehiclesPerHour must be positive`);
    }
    if (src.destinations.length === 0) {
      errors.push(`source "${src.id}" must have at least one destination`);
    }
    for (const dest of src.destinations) {
      if (!(dest.weight > 0)) {
        errors.push(
          `source "${src.id}" destination ${dest.exitEdgeId} weight must be positive`,
        );
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Demand validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}
