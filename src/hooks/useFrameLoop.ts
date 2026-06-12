import { useEffect, useRef, useState } from 'react';

export interface FrameStats {
  readonly renderFps: number;
  readonly tickNumber: number;
}

export interface UseFrameLoopArgs {
  readonly enabled: boolean;
  readonly tickNumberView: Uint32Array | null;
  readonly onFrame: (nowMs: number, dtMs: number) => void;
}

export function useFrameLoop({ enabled, tickNumberView, onFrame }: UseFrameLoopArgs): FrameStats {
  const [stats, setStats] = useState<FrameStats>({ renderFps: 0, tickNumber: 0 });
  // Keep onFrame + tickNumberView behind refs so the rAF effect can stay
  // dependent only on `enabled`. Otherwise every render of the caller would
  // recreate `onFrame`, retrigger the effect, and tear down/recreate the loop.
  const onFrameRef = useRef(onFrame);
  const tickViewRef = useRef(tickNumberView);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);
  useEffect(() => { tickViewRef.current = tickNumberView; }, [tickNumberView]);

  useEffect(() => {
    if (!enabled) return;

    let rafId: number | null = null;
    let lastMs = 0;
    let fpsAccumMs = 0;
    let fpsFrames = 0;

    const loop = (nowMs: number) => {
      const dtMs = lastMs === 0 ? 0 : nowMs - lastMs;
      lastMs = nowMs;
      onFrameRef.current(nowMs, dtMs);

      fpsAccumMs += dtMs;
      fpsFrames += 1;
      if (fpsAccumMs >= 500) {
        const fps = (fpsFrames / fpsAccumMs) * 1000;
        const tickView = tickViewRef.current;
        setStats({
          renderFps: Math.round(fps),
          tickNumber: tickView ? tickView[0]! : 0,
        });
        fpsAccumMs = 0;
        fpsFrames = 0;
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [enabled]);

  return stats;
}
