import { useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PolygonLayer } from '@deck.gl/layers';
import type { BoundingBox, SabViews } from '@traffic-lens/shared';
import { INITIAL_VIEW, BASE_STYLE } from '../config/map.ts';
import { useFrameLoop } from '../hooks/useFrameLoop.ts';
import { createSnapshot, updateSnapshotAndAlpha } from '../render/interpolation.ts';
import { buildVehicleLayer } from '../render/vehicle-layer.ts';

// Static outline of the simulated extent (graph bbox). Vehicles despawn when
// they reach a boundary edge, so this rectangle marks where that happens.
function buildBoundaryLayer(bbox: BoundingBox): PolygonLayer<number[][]> {
  const ring: number[][] = [
    [bbox.minLon, bbox.minLat],
    [bbox.maxLon, bbox.minLat],
    [bbox.maxLon, bbox.maxLat],
    [bbox.minLon, bbox.maxLat],
  ];
  return new PolygonLayer<number[][]>({
    id: 'boundary',
    data: [ring],
    getPolygon: (d) => d,
    stroked: true,
    filled: false,
    getLineColor: [255, 220, 80, 200],
    lineWidthMinPixels: 2,
    getLineWidth: 2,
  });
}

export interface MapViewProps {
  readonly views: SabViews | null;
  readonly bbox: BoundingBox | null;
  readonly running: boolean;
  readonly onStats: (renderFps: number, tickNumber: number) => void;
}

export function MapView({ views, bbox, running, onStats }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const snapshot = useMemo(createSnapshot, []);
  const boundaryLayer = useMemo(() => (bbox ? buildBoundaryLayer(bbox) : null), [bbox]);

  // Init map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
      zoom: INITIAL_VIEW.zoom,
      pitch: INITIAL_VIEW.pitch,
      bearing: INITIAL_VIEW.bearing,
    });
    mapRef.current = map;

    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    overlayRef.current = overlay;
    map.addControl(overlay as unknown as maplibregl.IControl);

    return () => {
      overlay.finalize();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  const tickView = views ? views.control.tickNumber : null;

  const stats = useFrameLoop({
    enabled: !!views,
    tickNumberView: tickView,
    onFrame: (nowMs) => {
      if (!views || !overlayRef.current) return;
      const alpha = updateSnapshotAndAlpha(snapshot, views, nowMs);

      overlayRef.current.setProps({
        layers: [
          ...(boundaryLayer ? [boundaryLayer] : []),
          buildVehicleLayer({ views, snapshot, alpha, layerId: 'vehicles' }),
        ],
      });
    },
  });

  // Suppress unused-warning for `running` (Plan C uses it later for cosmetic UI).
  void running;

  useEffect(() => {
    onStats(stats.renderFps, stats.tickNumber);
  }, [stats.renderFps, stats.tickNumber, onStats]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
}
