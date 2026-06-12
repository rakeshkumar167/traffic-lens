import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Demand, FromWorkerMessage, RoadGraph,
} from '@traffic-lens/shared';
// Vite's `?worker` import gives us a Worker constructor for the sim entry.
import SimWorker from '../../packages/sim/src/worker.ts?worker';

export interface WorkerHandle {
  readonly ready: boolean;
  readonly error: string | null;
  play(): void;
  pause(): void;
  step(): void;
  setSpeed(multiplier: number): void;
  reseed(seed: number): void;
}

export interface UseWorkerArgs {
  readonly graph: RoadGraph | null;
  readonly demand: Demand | null;
  readonly sab: SharedArrayBuffer | null;
}

export function useWorker({ graph, demand, sab }: UseWorkerArgs): WorkerHandle {
  const workerRef = useRef<Worker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!graph || !demand || !sab) return;

    const worker = new SimWorker({ type: 'module' });
    workerRef.current = worker;
    setReady(false);
    setError(null);

    worker.onmessage = (event: MessageEvent<FromWorkerMessage>) => {
      if (event.data.type === 'ready') setReady(true);
      else if (event.data.type === 'error') setError(event.data.message);
    };
    worker.onerror = (event) => setError(event.message ?? 'Worker error');

    worker.postMessage({ type: 'init', graph, demand, sab });

    return () => {
      worker.terminate();
      workerRef.current = null;
      setReady(false);
    };
  }, [graph, demand, sab]);

  // Stable callbacks — workerRef is always read at call time, so the identities
  // can be memoized once and consumers won't churn useEffect/useCallback deps.
  const actions = useMemo(() => ({
    play: () => workerRef.current?.postMessage({ type: 'play' }),
    pause: () => workerRef.current?.postMessage({ type: 'pause' }),
    step: () => workerRef.current?.postMessage({ type: 'step' }),
    setSpeed: (multiplier: number) =>
      workerRef.current?.postMessage({ type: 'setSpeed', multiplier }),
    reseed: (seed: number) =>
      workerRef.current?.postMessage({ type: 'reseed', seed }),
  }), []);

  return { ready, error, ...actions };
}
