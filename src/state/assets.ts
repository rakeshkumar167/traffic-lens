import type { Demand, RoadGraph } from '@traffic-lens/shared';

export interface AppAssets {
  readonly graph: RoadGraph;
  readonly demand: Demand;
}

export async function loadAssets(): Promise<AppAssets> {
  const [graphRes, demandRes] = await Promise.all([
    fetch('/data/koramangala.graph.json'),
    fetch('/data/koramangala.demand.json'),
  ]);
  if (!graphRes.ok) throw new Error(`Failed to load graph: ${graphRes.status}`);
  if (!demandRes.ok) throw new Error(`Failed to load demand: ${demandRes.status}`);
  const graph = (await graphRes.json()) as RoadGraph;
  const demand = (await demandRes.json()) as Demand;
  return { graph, demand };
}
