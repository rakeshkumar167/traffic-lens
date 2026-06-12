import type {
  FromWorkerMessage, ToWorkerMessage,
} from '@traffic-lens/shared';
import { World } from './world.ts';
import { tick } from './tick.ts';

export interface WorkerDriver {
  handleMessage(msg: ToWorkerMessage): FromWorkerMessage | null;
  isRunning(): boolean;
  runOneTick(): void;
}

export function createWorkerDriver(): WorkerDriver {
  let world: World | null = null;
  let running = false;
  let speedMultiplier = 1;

  return {
    handleMessage(msg) {
      try {
        switch (msg.type) {
          case 'init':
            world = World.init({ graph: msg.graph, demand: msg.demand, sab: msg.sab });
            running = false;
            return { type: 'ready' };
          case 'play':
            if (!world) throw new Error('Cannot play before init');
            running = true;
            return null;
          case 'pause':
            running = false;
            return null;
          case 'step':
            if (!world) throw new Error('Cannot step before init');
            tick(world);
            return null;
          case 'setSpeed':
            if (msg.multiplier <= 0) throw new Error('multiplier must be positive');
            speedMultiplier = msg.multiplier;
            return null;
          case 'reseed':
            if (!world) throw new Error('Cannot reseed before init');
            world = World.init({
              graph: world.graph,
              demand: { ...world.demand, seed: msg.seed },
              sab: world.views.posX.buffer as SharedArrayBuffer,
              seed: msg.seed,
            });
            return null;
        }
      } catch (err) {
        return {
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          tick: world ? world.views.control.tickNumber[0]! : 0,
        };
      }
    },
    isRunning(): boolean {
      return running;
    },
    runOneTick(): void {
      if (!world || !running) return;
      const steps = Math.max(1, Math.round(speedMultiplier));
      for (let i = 0; i < steps; i++) tick(world);
    },
  };
}
