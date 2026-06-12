import type { EdgeId } from '@traffic-lens/shared';
import {
  MAX_VEHICLES,
  STATE_ACTIVE,
  STATE_FREE,
  type SabViews,
} from '@traffic-lens/shared';

export interface SpawnInit {
  readonly posX: number;
  readonly posY: number;
  readonly heading: number;
  readonly speed: number;
  readonly accel: number;
  readonly edgeId: EdgeId;
  readonly edgeProgress: number;
  readonly lane: number;
  readonly vehicleType: number;
  readonly route: Uint32Array;
}

export class VehicleStore {
  readonly views: SabViews;
  private readonly freeList: number[];
  private readonly routes = new Map<number, Uint32Array>();
  private active = 0;

  constructor(views: SabViews) {
    this.views = views;
    this.freeList = Array.from({ length: MAX_VEHICLES }, (_, i) => MAX_VEHICLES - 1 - i);
    // State buffer is zero-initialized by SAB; that means every slot is STATE_FREE.
  }

  spawn(init: SpawnInit): number {
    const idx = this.freeList.pop();
    if (idx === undefined) {
      throw new Error(`VehicleStore: no free slot, MAX_VEHICLES=${MAX_VEHICLES} reached`);
    }
    const v = this.views;
    v.posX[idx] = init.posX;
    v.posY[idx] = init.posY;
    v.heading[idx] = init.heading;
    v.speed[idx] = init.speed;
    v.accel[idx] = init.accel;
    v.edgeId[idx] = init.edgeId;
    v.edgeProgress[idx] = init.edgeProgress;
    v.lane[idx] = init.lane;
    v.state[idx] = STATE_ACTIVE;
    v.vehicleType[idx] = init.vehicleType;
    v.routeIdx[idx] = 0;
    this.routes.set(idx, init.route);
    this.active++;
    return idx;
  }

  despawn(idx: number): void {
    const v = this.views;
    if (v.state[idx] === STATE_FREE) return;
    v.state[idx] = STATE_FREE;
    v.posX[idx] = 0;
    v.posY[idx] = 0;
    v.heading[idx] = 0;
    v.speed[idx] = 0;
    v.accel[idx] = 0;
    v.edgeId[idx] = 0;
    v.edgeProgress[idx] = 0;
    v.lane[idx] = 0;
    v.vehicleType[idx] = 0;
    v.routeIdx[idx] = 0;
    this.routes.delete(idx);
    this.freeList.push(idx);
    this.active--;
  }

  getRoute(idx: number): Uint32Array | undefined {
    return this.routes.get(idx);
  }

  forEachActive(cb: (idx: number) => void): void {
    const state = this.views.state;
    for (let i = 0; i < MAX_VEHICLES; i++) {
      if (state[i] === STATE_ACTIVE) cb(i);
    }
  }

  activeCount(): number {
    return this.active;
  }
}
