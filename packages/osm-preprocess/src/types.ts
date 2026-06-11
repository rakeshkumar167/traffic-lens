import type { RoadClass } from '@traffic-lens/shared';

export interface OsmNode {
  readonly id: number;
  readonly lon: number;
  readonly lat: number;
  readonly tags: Readonly<Record<string, string>>;
}

export interface OsmWay {
  readonly id: number;
  readonly nodeRefs: readonly number[];
  readonly tags: Readonly<Record<string, string>>;
}

export interface ParsedOsm {
  readonly nodes: ReadonlyMap<number, OsmNode>;
  readonly drivableWays: readonly OsmWay[];
}

export const DRIVABLE_HIGHWAY_VALUES: ReadonlySet<RoadClass> = new Set<RoadClass>([
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'residential',
  'unclassified',
  'service',
]);

export function isDrivableHighwayValue(value: string | undefined): value is RoadClass {
  return value !== undefined && (DRIVABLE_HIGHWAY_VALUES as ReadonlySet<string>).has(value);
}
