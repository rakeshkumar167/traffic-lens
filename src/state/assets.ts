import type { RoadGraph } from '@traffic-lens/shared';

// Load a preprocessed road graph served from /data/<file>.
export async function loadGraph(file: string): Promise<RoadGraph> {
  const res = await fetch(`/data/${file}`);
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
  return (await res.json()) as RoadGraph;
}
