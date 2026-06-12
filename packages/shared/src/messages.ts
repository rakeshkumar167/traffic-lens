import type { RoadGraph } from './road-graph.ts';
import type { Demand } from './demand.ts';

// Messages sent from the main thread to the sim worker.
export type ToWorkerMessage =
  | InitMessage
  | PlayMessage
  | PauseMessage
  | StepMessage
  | SetSpeedMessage
  | ReseedMessage;

export interface InitMessage {
  readonly type: 'init';
  readonly graph: RoadGraph;
  readonly demand: Demand;
  readonly sab: SharedArrayBuffer;
}

export interface PlayMessage { readonly type: 'play'; }
export interface PauseMessage { readonly type: 'pause'; }
export interface StepMessage { readonly type: 'step'; }
export interface SetSpeedMessage {
  readonly type: 'setSpeed';
  readonly multiplier: number;
}
export interface ReseedMessage {
  readonly type: 'reseed';
  readonly seed: number;
}

// Messages from the worker to the main thread.
export type FromWorkerMessage = ReadyMessage | ErrorMessage;

export interface ReadyMessage { readonly type: 'ready'; }
export interface ErrorMessage {
  readonly type: 'error';
  readonly message: string;
  readonly tick: number;
}
