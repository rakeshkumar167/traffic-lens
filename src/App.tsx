import { useCallback, useEffect, useMemo, useState } from 'react';
import { STATE_ACTIVE, MAX_VEHICLES } from '@traffic-lens/shared';
import type { Demand, RoadGraph } from '@traffic-lens/shared';
import { loadAssets } from './state/assets.ts';
import { allocateSimSab } from './state/sab.ts';
import { useWorker } from './hooks/useWorker.ts';
import { MapView } from './components/MapView.tsx';
import { PlaybackBar } from './components/PlaybackBar.tsx';

export function App() {
  const [graph, setGraph] = useState<RoadGraph | null>(null);
  const [demand, setDemand] = useState<Demand | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sim = useMemo(allocateSimSab, []);

  useEffect(() => {
    let cancelled = false;
    loadAssets()
      .then((a) => {
        if (cancelled) return;
        setGraph(a.graph);
        setDemand(a.demand);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const worker = useWorker({ graph, demand, sab: sim.sab });

  const [running, setRunning] = useState(false);
  const [renderFps, setRenderFps] = useState(0);
  const [tickNumber, setTickNumber] = useState(0);

  const handleStats = useCallback((fps: number, tick: number) => {
    setRenderFps(fps);
    setTickNumber(tick);
  }, []);

  const handlePlay = useCallback(() => {
    worker.play();
    setRunning(true);
  }, [worker]);

  const handlePause = useCallback(() => {
    worker.pause();
    setRunning(false);
  }, [worker]);

  // Count active vehicles by scanning the state typed-array.
  const [activeCount, setActiveCount] = useState(0);
  useEffect(() => {
    if (!worker.ready) return;
    const id = window.setInterval(() => {
      let n = 0;
      for (let i = 0; i < MAX_VEHICLES; i++) {
        if (sim.views.state[i] === STATE_ACTIVE) n++;
      }
      setActiveCount(n);
    }, 250);
    return () => window.clearInterval(id);
  }, [worker.ready, sim.views.state]);

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
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }

  return (
    <>
      <MapView
        views={worker.ready ? sim.views : null}
        bbox={graph?.meta.bbox ?? null}
        running={running}
        onStats={handleStats}
      />
      <PlaybackBar
        ready={worker.ready}
        running={running}
        tickNumber={tickNumber}
        activeVehicles={activeCount}
        renderFps={renderFps}
        onPlay={handlePlay}
        onPause={handlePause}
        onStep={worker.step}
        onSetSpeed={worker.setSpeed}
      />
    </>
  );
}
