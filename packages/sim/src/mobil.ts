import { idmAcceleration, type IdmParams } from './idm.ts';

export interface MobilParams {
  readonly politeness: number;        // p — weight on others' accel change
  readonly threshold: number;         // Δa_th — incentive threshold (m/s²)
  readonly bSafe: number;             // max tolerable braking for new follower (m/s²)
}

export const DEFAULT_MOBIL_PARAMS: MobilParams = {
  politeness: 0.3,
  threshold: 0.2,
  bSafe: 4.0,
};

interface Neighbor {
  readonly speed: number;
  readonly gap: number;
}

interface FollowerNeighbor extends Neighbor {
  readonly v0: number;
}

export interface MobilInput {
  readonly self: {
    readonly speed: number;
    readonly v0: number;
  };
  readonly currentLeader: Neighbor;
  readonly newLaneLeader: Neighbor;
  readonly newLaneFollower: FollowerNeighbor;
  readonly oldLaneFollower: FollowerNeighbor;
  // Strong positive bias added to the incentive term for must-change-for-route
  // scenarios. 0 for discretionary changes.
  readonly mandatoryBias: number;
  readonly idm: IdmParams;
  readonly mobil: MobilParams;
}

export function mobilDecision(input: MobilInput): boolean {
  const { self, currentLeader, newLaneLeader, newLaneFollower, oldLaneFollower,
          mandatoryBias, idm, mobil } = input;

  const aSelfCur = idmAcceleration({
    speed: self.speed, leaderSpeed: currentLeader.speed,
    gap: currentLeader.gap, v0: self.v0, params: idm,
  });
  const aSelfNew = idmAcceleration({
    speed: self.speed, leaderSpeed: newLaneLeader.speed,
    gap: newLaneLeader.gap, v0: self.v0, params: idm,
  });

  // New follower's accel — gap from new follower's perspective shrinks to `self`.
  const aNewFolBefore = idmAcceleration({
    speed: newLaneFollower.speed, leaderSpeed: newLaneLeader.speed,
    gap: newLaneFollower.gap + newLaneLeader.gap, v0: newLaneFollower.v0, params: idm,
  });
  const aNewFolAfter = idmAcceleration({
    speed: newLaneFollower.speed, leaderSpeed: self.speed,
    gap: newLaneFollower.gap, v0: newLaneFollower.v0, params: idm,
  });

  // Safety: new follower must not brake worse than -bSafe.
  if (aNewFolAfter < -mobil.bSafe) return false;

  // Old follower will see a relaxed leader once self moves out.
  const aOldFolBefore = idmAcceleration({
    speed: oldLaneFollower.speed, leaderSpeed: self.speed,
    gap: oldLaneFollower.gap, v0: oldLaneFollower.v0, params: idm,
  });
  const aOldFolAfter = idmAcceleration({
    speed: oldLaneFollower.speed, leaderSpeed: currentLeader.speed,
    gap: oldLaneFollower.gap + currentLeader.gap, v0: oldLaneFollower.v0, params: idm,
  });

  const ownGain = aSelfNew - aSelfCur;
  const othersGain = (aNewFolAfter - aNewFolBefore) + (aOldFolAfter - aOldFolBefore);
  const incentive = ownGain + mobil.politeness * othersGain + mandatoryBias;
  return incentive > mobil.threshold;
}
