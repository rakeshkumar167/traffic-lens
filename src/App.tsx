import { useCallback, useEffect, useMemo, useState } from 'react';
import { STATE_ACTIVE, MAX_VEHICLES } from '@traffic-lens/shared';
import type { BoundingBox, Demand, EdgeId, RoadGraph, SabViews } from '@traffic-lens/shared';
import { clipGraph, buildDemand } from '@traffic-lens/sim';
import { loadGraph } from './state/assets.ts';
import { allocateSimSab } from './state/sab.ts';
import { useWorker } from './hooks/useWorker.ts';
import { MapView, type MapMode } from './components/MapView.tsx';
import { PlaybackBar } from './components/PlaybackBar.tsx';
import { SetupBar } from './components/SetupBar.tsx';
import { Navbar } from './components/Navbar.tsx';
import { HelpModal } from './components/HelpModal.tsx';
import { buildSignalMarkers } from './render/signal-layer.ts';
import { buildEntryMarkers } from './render/entry-points.ts';
import { DEFAULT_REGION, regionByKey } from './config/regions.ts';

const HELP_SEEN_KEY = 'traffic-lens-help-seen';

interface SimConfig {
  readonly graph: RoadGraph;
  readonly demand: Demand;
  readonly sab: SharedArrayBuffer;
  readonly views: SabViews;
}

export function App() {
  const [graph, setGraph] = useState<RoadGraph | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [regionKey, setRegionKey] = useState(DEFAULT_REGION.key);
  const [mode, setMode] = useState<MapMode>('drawing');
  const [selectionRect, setSelectionRect] = useState<BoundingBox | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<EdgeId[]>([]);
  const [intensity, setIntensity] = useState(800);
  const [simConfig, setSimConfig] = useState<SimConfig | null>(null);

  // Load the selected region's graph (re-runs when the region changes).
  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setLoadError(null);
    loadGraph(regionByKey(regionKey).file)
      .then((g) => { if (!cancelled) setGraph(g); })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [regionKey]);

  const worker = useWorker({
    graph: simConfig?.graph ?? null,
    demand: simConfig?.demand ?? null,
    sab: simConfig?.sab ?? null,
  });
  const { ready: workerReady, play: workerPlay } = worker;

  // Preview the clip for the current selection (drives entry/exit counts and the
  // Start gate) and reuse it on Start.
  const clip = useMemo(
    () => (graph && selectionRect ? clipGraph(graph, selectionRect) : null),
    [graph, selectionRect],
  );

  // Geographic extent of the loaded network (where roads exist) — drawn as a
  // grey guide so the user knows where a selection will contain a network.
  const dataExtent = useMemo<BoundingBox | null>(() => {
    if (!graph || graph.junctions.length === 0) return null;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const j of graph.junctions) {
      if (j.lon < minLon) minLon = j.lon;
      if (j.lon > maxLon) maxLon = j.lon;
      if (j.lat < minLat) minLat = j.lat;
      if (j.lat > maxLat) maxLat = j.lat;
    }
    return { minLon, minLat, maxLon, maxLat };
  }, [graph]);

  // Candidate spawn points for the current selection (highlighted for picking).
  const entryMarkers = useMemo(
    () => (clip ? buildEntryMarkers(clip.graph, clip.entryEdgeIds) : null),
    [clip],
  );

  // Drawing a new box replaces the selection and clears any picked spawn points.
  const handleSelectionChange = useCallback((bbox: BoundingBox) => {
    setSelectionRect(bbox);
    setSelectedEntryIds([]);
  }, []);

  const handleToggleEntry = useCallback((edgeId: EdgeId) => {
    setSelectedEntryIds((prev) => (
      prev.includes(edgeId) ? prev.filter((id) => id !== edgeId) : [...prev, edgeId]
    ));
  }, []);

  const handleRedraw = useCallback(() => {
    setSelectionRect(null);
    setSelectedEntryIds([]);
  }, []);

  // Signal markers for the running region (recomputed only when a run starts).
  const signalData = useMemo(
    () => (simConfig ? buildSignalMarkers(simConfig.graph) : null),
    [simConfig],
  );

  const [running, setRunning] = useState(false);
  const [renderFps, setRenderFps] = useState(0);
  const [tickNumber, setTickNumber] = useState(0);

  // Show the help modal automatically on a user's first visit.
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(HELP_SEEN_KEY)) setHelpOpen(true);
    } catch { /* localStorage unavailable — skip auto-open */ }
  }, []);
  const handleHelpClose = useCallback(() => {
    setHelpOpen(false);
    try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch { /* ignore */ }
  }, []);

  const handleStats = useCallback((fps: number, tick: number) => {
    setRenderFps(fps);
    setTickNumber(tick);
  }, []);

  const handleStart = useCallback(() => {
    if (!clip || selectedEntryIds.length === 0 || clip.exitEdgeIds.length === 0) return;
    const sim = allocateSimSab();
    const demand = buildDemand(selectedEntryIds, clip.exitEdgeIds, intensity, 42);
    setSimConfig({ graph: clip.graph, demand, sab: sim.sab, views: sim.views });
    setMode('running');
  }, [clip, selectedEntryIds, intensity]);

  const handleReset = useCallback(() => {
    setSimConfig(null);
    setMode('drawing');
    setSelectionRect(null);
    setSelectedEntryIds([]);
    setRunning(false);
  }, []);

  // Switching region resets the setup and loads the new area's graph.
  const handleRegionChange = useCallback((key: string) => {
    setRegionKey(key);
    setSimConfig(null);
    setMode('drawing');
    setSelectionRect(null);
    setSelectedEntryIds([]);
    setRunning(false);
  }, []);

  // Auto-play once the worker for a started region is ready.
  useEffect(() => {
    if (mode === 'running' && workerReady) {
      workerPlay();
      setRunning(true);
    }
  }, [mode, workerReady, workerPlay]);

  const handlePlay = useCallback(() => { worker.play(); setRunning(true); }, [worker]);
  const handlePause = useCallback(() => { worker.pause(); setRunning(false); }, [worker]);

  // Count active vehicles by scanning the state typed-array.
  const [activeCount, setActiveCount] = useState(0);
  const views = simConfig?.views ?? null;
  useEffect(() => {
    if (!workerReady || !views) return;
    const id = window.setInterval(() => {
      let n = 0;
      for (let i = 0; i < MAX_VEHICLES; i++) {
        if (views.state[i] === STATE_ACTIVE) n++;
      }
      setActiveCount(n);
    }, 250);
    return () => window.clearInterval(id);
  }, [workerReady, views]);

  if (loadError) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Traffic Lens</h1>
        <p style={{ color: '#ff8888' }}>Failed to load assets: {loadError}</p>
      </div>
    );
  }

  if (worker.error) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Traffic Lens</h1>
        <p style={{ color: '#ff8888' }}>Sim worker error: {worker.error}</p>
        <button onClick={handleReset}>Back to setup</button>
      </div>
    );
  }

  return (
    <>
      <Navbar
        regionKey={regionKey}
        onRegionChange={handleRegionChange}
        showReset={mode === 'running'}
        onReset={handleReset}
        onHelp={() => setHelpOpen(true)}
      />
      <MapView
        views={workerReady ? views : null}
        mode={mode}
        selectionRect={selectionRect}
        dataExtent={dataExtent}
        signalData={signalData}
        entryMarkers={entryMarkers}
        selectedEntryIds={selectedEntryIds}
        onToggleEntry={handleToggleEntry}
        onSelectionChange={handleSelectionChange}
        running={running}
        onStats={handleStats}
      />
      {mode === 'drawing' && (
        <div style={hintStyle}>
          {selectionRect === null
            ? 'Drag on the map to draw a region'
            : (entryMarkers?.length ?? 0) === 0
              ? 'No roads cross this region — draw a larger box'
              : selectedEntryIds.length === 0
                ? 'Tap the pink points to choose where vehicles enter'
                : `${selectedEntryIds.length} spawn point${selectedEntryIds.length > 1 ? 's' : ''} selected — tap more, or press Start`}
        </div>
      )}
      {mode === 'drawing' ? (
        <SetupBar
          hasSelection={selectionRect !== null}
          availableEntries={entryMarkers?.length ?? 0}
          selectedEntries={selectedEntryIds.length}
          intensity={intensity}
          onIntensityChange={setIntensity}
          onStart={handleStart}
          onRedraw={handleRedraw}
        />
      ) : (
        <PlaybackBar
          ready={workerReady}
          running={running}
          tickNumber={tickNumber}
          activeVehicles={activeCount}
          renderFps={renderFps}
          onPlay={handlePlay}
          onPause={handlePause}
          onStep={worker.step}
          onSetSpeed={worker.setSpeed}
        />
      )}
      {helpOpen && <HelpModal onClose={handleHelpClose} />}
    </>
  );
}

const hintStyle: React.CSSProperties = {
  position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)',
  zIndex: 3, padding: '8px 16px', maxWidth: '90vw', textAlign: 'center',
  background: 'rgba(0, 90, 156, 0.92)', color: '#fff', fontSize: 14, fontWeight: 600,
  borderRadius: 999, boxShadow: '0 4px 14px rgba(0,0,0,0.35)', pointerEvents: 'none',
};
