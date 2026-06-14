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
import { buildSignalLayer, type SignalRenderData } from '../render/signal-layer.ts';
import { buildEntryLayer, type EntryMarker } from '../render/entry-points.ts';
import type { EdgeId } from '@traffic-lens/shared';

export type MapMode = 'drawing' | 'running';

function bboxFromCorners(a: maplibregl.LngLat, b: maplibregl.LngLat): BoundingBox {
  return {
    minLon: Math.min(a.lng, b.lng),
    maxLon: Math.max(a.lng, b.lng),
    minLat: Math.min(a.lat, b.lat),
    maxLat: Math.max(a.lat, b.lat),
  };
}

function ringOf(bbox: BoundingBox): number[][] {
  return [
    [bbox.minLon, bbox.minLat],
    [bbox.maxLon, bbox.minLat],
    [bbox.maxLon, bbox.maxLat],
    [bbox.minLon, bbox.maxLat],
  ];
}

// Outline of the selected region (the rectangle the user drew). A thin #005A9C
// border plus a faint fill so the active extent is visible but unobtrusive.
function buildSelectionLayer(bbox: BoundingBox): PolygonLayer<number[][]> {
  return new PolygonLayer<number[][]>({
    id: 'selection',
    data: [ringOf(bbox)],
    getPolygon: (d) => d,
    stroked: true,
    filled: true,
    getFillColor: [0, 90, 156, 30],
    getLineColor: [0, 90, 156, 230],
    lineWidthMinPixels: 1,
    getLineWidth: 1,
  });
}

// Grey guide outline of the available data extent — the only area roads exist,
// so the user knows where a selection will actually contain a network.
function buildGuideLayer(bbox: BoundingBox): PolygonLayer<number[][]> {
  return new PolygonLayer<number[][]>({
    id: 'data-extent',
    data: [ringOf(bbox)],
    getPolygon: (d) => d,
    stroked: true,
    filled: false,
    getLineColor: [150, 150, 150, 170],
    lineWidthMinPixels: 2,
    getLineWidth: 2,
  });
}

export interface MapViewProps {
  readonly views: SabViews | null;
  readonly mode: MapMode;
  readonly selectionRect: BoundingBox | null;
  readonly dataExtent: BoundingBox | null;
  readonly signalData: SignalRenderData | null;
  readonly entryMarkers: EntryMarker[] | null;
  readonly selectedEntryIds: EdgeId[];
  readonly onToggleEntry: (edgeId: EdgeId) => void;
  readonly onSelectionChange: (bbox: BoundingBox) => void;
  readonly running: boolean;
  readonly onStats: (renderFps: number, tickNumber: number) => void;
}

export function MapView({
  views, mode, selectionRect, dataExtent, signalData,
  entryMarkers, selectedEntryIds, onToggleEntry, onSelectionChange, running, onStats,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const snapshot = useMemo(createSnapshot, []);
  const guideLayer = useMemo(() => (dataExtent ? buildGuideLayer(dataExtent) : null), [dataExtent]);

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
      // The top navbar and bottom bar occupy both edges, so MapLibre's own
      // attribution control has nowhere clear to sit — it's rendered as text in
      // the navbar instead (see Navbar).
      attributionControl: false,
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
      const simSec = views.control.simWallClockSec[0]!;
      overlayRef.current.setProps({
        layers: [
          ...(guideLayer ? [guideLayer] : []),
          ...(selectionRect ? [buildSelectionLayer(selectionRect)] : []),
          buildVehicleLayer({ views, snapshot, alpha, layerId: 'vehicles' }),
          ...(signalData ? [buildSignalLayer(signalData, simSec)] : []),
        ],
      });
    },
  });

  // Setup mode. Two sub-steps: with no box, drag to draw one; with a box, click
  // the highlighted entry points to pick spawn locations (drawing is disabled so
  // clicks only toggle markers).
  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    const container = containerRef.current;
    if (!map || !overlay || !container || mode !== 'drawing') return;

    // Pick sub-step: a box exists — show entry markers and toggle on click.
    if (selectionRect) {
      overlay.setProps({
        layers: [
          ...(guideLayer ? [guideLayer] : []),
          buildSelectionLayer(selectionRect),
          ...(entryMarkers ? [buildEntryLayer(entryMarkers, selectedEntryIds)] : []),
        ],
        onClick: (info) => {
          if (info?.layer?.id === 'entry-points' && info.object) {
            onToggleEntry((info.object as EntryMarker).edgeId);
          }
        },
      });
      return;
    }

    // Draw sub-step: no box yet — drag to draw one.
    const drawRect = (bbox: BoundingBox | null) =>
      overlay.setProps({
        layers: [
          ...(guideLayer ? [guideLayer] : []),
          ...(bbox ? [buildSelectionLayer(bbox)] : []),
        ],
        onClick: null,
      });
    drawRect(null);

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
        drawRect(null); // treat as a click, nothing to draw yet
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
  }, [mode, selectionRect, guideLayer, entryMarkers, selectedEntryIds, onToggleEntry, onSelectionChange]);

  // On entering running mode, frame the map to the selected region so the user
  // is looking exactly where vehicles enter (they spawn at the region's edges).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mode !== 'running' || !selectionRect) return;
    map.fitBounds(
      [
        [selectionRect.minLon, selectionRect.minLat],
        [selectionRect.maxLon, selectionRect.maxLat],
      ],
      { padding: 60, duration: 700 },
    );
  }, [mode, selectionRect]);

  // Suppress unused-warning for `running` (Plan C uses it later for cosmetic UI).
  void running;

  useEffect(() => {
    onStats(stats.renderFps, stats.tickNumber);
  }, [stats.renderFps, stats.tickNumber, onStats]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
}
