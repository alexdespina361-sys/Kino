/** Where the TV being followed is, as the server relays it. */
export interface SyncTarget {
  playing: boolean;
  time: number;
  rate: number;
}

/** Where this follower's own picture is. */
export interface SyncLocal {
  playing: boolean;
  time: number;
  rate: number;
  /** Waiting for data: chasing the leader would only make that worse. */
  buffering: boolean;
}

/** What to do about it: whether to be playing, a position to jump to, and the speed to play at. */
export interface SyncStep {
  play: boolean;
  seek?: number;
  rate: number;
}

/** Further apart than this, playing faster or slower would take too long: jump. */
export const HARD_SEEK_S = 1;
/** Between this and a jump, catch up by playing a little faster or slower. */
export const NUDGE_FROM_S = 0.2;
export const NUDGE = 0.08;
/** A paused picture only needs to be near, since nothing moves. */
export const PAUSED_TOLERANCE_S = 0.5;
/** After a jump the picture needs a moment to fill; a second jump before then would only chase it. */
export const SEEK_COOLDOWN_MS = 3000;

/** One step toward the leader, from its last report. Pure: the caller does what it says. */
export function syncStep(target: SyncTarget, local: SyncLocal, msSinceSeek: number): SyncStep {
  const drift = local.time - target.time; // positive: this TV is ahead
  if (!target.playing) {
    return { play: false, rate: target.rate, ...(Math.abs(drift) > PAUSED_TOLERANCE_S ? { seek: target.time } : {}) };
  }
  if (Math.abs(drift) > HARD_SEEK_S && msSinceSeek > SEEK_COOLDOWN_MS) return { play: true, seek: target.time, rate: target.rate };
  if (!local.buffering && Math.abs(drift) > NUDGE_FROM_S) return { play: true, rate: target.rate * (drift > 0 ? 1 - NUDGE : 1 + NUDGE) };
  return { play: true, rate: target.rate };
}
