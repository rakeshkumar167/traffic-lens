// Available preprocessed regions. Each `file` lives under data/ and is served at
// /data/<file>. To add a region: fetch its OSM extract, run the osm-preprocess
// CLI to emit the graph, drop it in data/, and add an entry here.
export interface Region {
  readonly key: string;
  readonly label: string;
  readonly file: string;
}

export const REGIONS: readonly Region[] = [
  { key: 'koramangala', label: 'Koramangala', file: 'koramangala.graph.json' },
  { key: 'indiranagar', label: 'Indiranagar', file: 'indiranagar.graph.json' },
  { key: 'hsr-layout', label: 'HSR Layout', file: 'hsr-layout.graph.json' },
  { key: 'jayanagar', label: 'Jayanagar', file: 'jayanagar.graph.json' },
  { key: 'mg-road', label: 'MG Road / CBD', file: 'mg-road.graph.json' },
  { key: 'whitefield', label: 'Whitefield', file: 'whitefield.graph.json' },
  { key: 'btm-layout', label: 'BTM Layout', file: 'btm-layout.graph.json' },
];

export const DEFAULT_REGION = REGIONS[0]!;

export function regionByKey(key: string): Region {
  return REGIONS.find((r) => r.key === key) ?? DEFAULT_REGION;
}
