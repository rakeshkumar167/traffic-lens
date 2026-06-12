/// <reference lib="webworker" />
import type { ToWorkerMessage } from '@traffic-lens/shared';
import { createWorkerDriver } from './worker-driver.ts';
import { TICK_DT } from './world.ts';

const driver = createWorkerDriver();
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let timer: ReturnType<typeof setInterval> | null = null;

ctx.onmessage = (event: MessageEvent<ToWorkerMessage>) => {
  const reply = driver.handleMessage(event.data);
  if (reply) ctx.postMessage(reply);
  // Start/stop the tick interval based on driver running state.
  if (driver.isRunning() && timer === null) {
    timer = setInterval(() => driver.runOneTick(), TICK_DT * 1000);
  } else if (!driver.isRunning() && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
};
