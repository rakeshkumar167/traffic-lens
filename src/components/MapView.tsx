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

export type MapMode = 'drawing' | 'running';

function bboxFromCorners(a: maplibregl.LngLat, b: maplibregl.LngLat): BoundingBox {
  return {
    minLon: Math.min(a.lng, b.lng),
    maxLon: Math.max(a.lng, b.lng),
    minLat: Math.min(a.lat, b.lat),
    maxLat: Math.max(a.lat, b.lat),
  };
}

// Outline of the selected region (the rectangle the user drew). Drawn with a
// thick border plus a faint fill so the active extent is easy to see.
function buildSelectionLayer(bbox: BoundingBox): PolygonLayer<number[][]> {
  const ring: number[][] = [
    [bbox.minLon, bbox.minLat],
    [bbox.maxLon, bbox.minLat],
    [bbox.maxLon, bbox.maxLat],
    [bbox.minLon, bbox.maxLat],
  ];
  return new PolygonLayer<number[][]>({
    id: 'selection',
    data: [ring],
    getPolygon: (d) => d,
    stroked: true,
    filled: true,
    getFillColor: [255, 220, 80, 22],
    getLineColor: [255, 220, 80, 220],
    lineWidthMinPixels: 4,
    getLineWidth: 4,
  });
}

export interface MapViewProps {
  readonly views: SabViews | null;
  readonly mode: MapMode;
  readonly selectionRect: BoundingBox | null;
  readonly onSelectionChange: (bbox: BoundingBox) => void;
  readonly running: boolean;
  readonly onStats: (renderFps: number, tickNumber: number) => void;
}

export function MapView({ views, mode, selectionRect, onSelectionChange, running, onStats }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const snapshot = useMemo(createSnapshot, []);

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

  // Running mode: animate vehicles (plus the selection outline) every frame.
  const stats = useFrameLoop({
    enabled: mode === 'running' && !!views,
    tickNumberView: views ? views.control.tickNumber : null,
    onFrame: (nowMs) => {
      if (!views || !overlayRef.current) return;
      const alpha = updateSnapshotAndAlpha(snapshot, views, nowMs);
      overlayRef.current.setProps({
        layers: [
          ...(selectionRect ? [buildSelectionLayer(selectionRect)] : []),
          buildVehicleLayer({ views, snapshot, alpha, layerId: 'vehicles' }),
        ],
      });
    },
  });

  // Drawing mode: drag to draw a rectangle; also keep the confirmed selection
  // (or a cleared canvas) on screen. Pan is disabled only while dragging.
  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    const container = containerRef.current;
    if (!map || !overlay || !container || mode !== 'drawing') return;

    const drawRect = (bbox: BoundingBox | null) =>
      overlay.setProps({ layers: bbox ? [buildSelectionLayer(bbox)] : [] });
    drawRect(selectionRect);

    const toLngLat = (clientX: number, clientY: number) => {
      const r = container.getBoundingClientRect();
      return map.unproject([clientX - r.left, clientY - r.top]);
    };

    let startScreen: { x: number; y: number } | null = null;
    let startLngLat: maplibregl.LngLat | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      startScreen = { x: e.clientX, y: e.clientY };
      startLngLat = toLngLat(e.clientX, e.clientY);
      map.dragPan.disable();
    };
    const onMove = (e: PointerEvent) => {
      if (!startLngLat) return;
      drawRect(bboxFromCorners(startLngLat, toLngLat(e.clientX, e.clientY)));
    };
    const onUp = (e: PointerEvent) => {
      if (!startLngLat || !startScreen) return;
      const dx = e.clientX - startScreen.x;
      const dy = e.clientY - startScreen.y;
      const from = startLngLat;
      startLngLat = null;
      startScreen = null;
      map.dragPan.enable();
      if (Math.hypot(dx, dy) < 6) {
        drawRect(selectionRect); // treat as a click, keep current selection
        return;
      }
      onSelectionChange(bboxFromCorners(from, toLngLat(e.clientX, e.clientY)));
    };

    container.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      container.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      map.dragPan.enable();
    };
  }, [mode, selectionRect, onSelectionChange]);

  // Suppress unused-warning for `running` (Plan C uses it later for cosmetic UI).
  void running;

  useEffect(() => {
    onStats(stats.renderFps, stats.tickNumber);
  }, [stats.renderFps, stats.tickNumber, onStats]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
}
