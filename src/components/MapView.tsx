import { useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';
import type { SabViews } from '@traffic-lens/shared';
import { STATE_ACTIVE } from '@traffic-lens/shared';
import { INITIAL_VIEW, BASE_STYLE } from '../config/map.ts';
import { useFrameLoop } from '../hooks/useFrameLoop.ts';
import { createSnapshot, updateSnapshotAndAlpha } from '../render/interpolation.ts';
import { buildVehicleLayer } from '../render/vehicle-layer.ts';

// Debug marker at the camera centre. If this never appears, the deck.gl
// overlay isn't actually rendering. If it appears but vehicles don't, the
// vehicles are at wrong lon/lat (projection bug or stale SAB data).
const DEBUG_CENTER_LAYER = new ScatterplotLayer({
  id: 'debug-center',
  data: [{ position: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude] }],
  getPosition: (d: { position: [number, number] }) => d.position,
  getRadius: 12,
  radiusMinPixels: 12,
  radiusMaxPixels: 12,
  getFillColor: [255, 0, 255, 255],
  stroked: true,
  lineWidthMinPixels: 2,
  getLineColor: [255, 255, 255, 255],
});

export interface MapViewProps {
  readonly views: SabViews | null;
  readonly running: boolean;
  readonly onStats: (renderFps: number, tickNumber: number) => void;
}

export function MapView({ views, running, onStats }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const debugLoggedRef = useRef(false);
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

  const tickView = views ? views.control.tickNumber : null;

  const stats = useFrameLoop({
    enabled: !!views,
    tickNumberView: tickView,
    onFrame: (nowMs) => {
      if (!views || !overlayRef.current) return;
      const alpha = updateSnapshotAndAlpha(snapshot, views, nowMs);

      // One-time debug: log the first active vehicle's world coords & projected lon/lat.
      if (!debugLoggedRef.current) {
        for (let i = 0; i < views.state.length; i++) {
          if (views.state[i] === STATE_ACTIVE) {
            const x = views.posX[i]!;
            const y = views.posY[i]!;
            const lon = (x / 6378137) * (180 / Math.PI);
            const lat = (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * (180 / Math.PI);
            // eslint-disable-next-line no-console
            console.log('[traffic-lens debug] first active slot=', i,
              'sab worldX=', x, 'worldY=', y,
              '→ lon=', lon, 'lat=', lat,
              'edgeId=', views.edgeId[i], 'edgeProgress=', views.edgeProgress[i],
              'speed=', views.speed[i]);
            debugLoggedRef.current = true;
            break;
          }
        }
      }

      overlayRef.current.setProps({
        layers: [
          DEBUG_CENTER_LAYER,
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
