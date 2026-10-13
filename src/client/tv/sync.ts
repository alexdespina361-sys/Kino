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
  /** How many seconds of picture it already has downloaded beyond where it is. */
  ahead: number;
  /** Whether the place the leader is at is already downloaded here, so that going there needs nothing from the network. */
  targetBuffered: boolean;
}

/** What to do about it: whether to be playing, a position to jump to, and the speed to play at. */
export interface SyncStep {
  play: boolean;
  seek?: number;
  rate: number;
}

/**
 * Where the leader is now, from a report of where it was. The report took `lag` seconds to get here (the server says how long, from the
 * round trips of the two screens), and a leader that plays has moved on by that much; aiming at the position as reported would keep
 * every guest behind the host by about that.
 */
export function leaderNow(report: { playing: boolean; time: number; rate: number; lag?: number | undefined }): number {
  return report.playing ? report.time + (report.lag ?? 0) * report.rate : report.time;
}

/** Further apart than this, playing faster or slower would take too long: jump. */
export const HARD_SEEK_S = 1;
/**
 * Between this and a jump, catch up by playing a little faster or slower. What is left of a report's age once `leaderNow` has added it is
 * the guess being a little off, so a nudge starts a little beyond that, and then goes on until the pictures are close (`NUDGE_UNTIL_S`),
 * instead of starting and stopping with every report.
 */
export const NUDGE_FROM_S = 0.15;
export const NUDGE_UNTIL_S = 0.05;
export const NUDGE = 0.08;
/** A paused picture only needs to be near, since nothing moves (but near enough to show the same frame). */
export const PAUSED_TOLERANCE_S = 0.1;
/**
 * A picture that is not playing when the leader is (a guest whose host has just started again) goes to the place at once if it is this
 * far from it and already has it: nothing to download, and nothing moving that the jump would disturb. Otherwise it would start about
 * a report's age behind and spend seconds catching up.
 */
export const RESUME_SEEK_S = 0.1;
/** After a jump the picture needs a moment to fill; a second jump before then would only chase it. */
export const SEEK_COOLDOWN_MS = 3000;
/**
 * A picture that is playing with less than this downloaded ahead is about to wait for data. It is not made to run faster (that
 * would use up what little it has), and it is not sent to a place it has not downloaded (it would wait there, fall behind again,
 * and be sent again, and so on): it plays on, and the jump comes when that place is downloaded.
 */
export const THIN_BUFFER_S = 4;
/** Behind by this much, waiting for the picture to arrive has gone on long enough: it jumps even to a place it has not downloaded. */
export const GIVE_UP_S = 15;

/** One step toward the leader, from its last report. Pure: the caller does what it says. */
export function syncStep(target: SyncTarget, local: SyncLocal, msSinceSeek: number): SyncStep {
  const drift = local.time - target.time; // positive: this TV is ahead
  const apart = Math.abs(drift);
  if (!target.playing) {
    return { play: false, rate: target.rate, ...(apart > PAUSED_TOLERANCE_S ? { seek: target.time } : {}) };
  }
  // (A picture that is not playing yet has nothing to run dry: it goes straight to the place, as a screen that has just joined must.)
  const thin = local.playing && (local.buffering || local.ahead < THIN_BUFFER_S);
  if (apart > HARD_SEEK_S && msSinceSeek > SEEK_COOLDOWN_MS && (!thin || local.targetBuffered || apart > GIVE_UP_S)) {
    return { play: true, seek: target.time, rate: target.rate };
  }
  if (!local.playing && apart > RESUME_SEEK_S && local.targetBuffered && msSinceSeek > SEEK_COOLDOWN_MS) {
    return { play: true, seek: target.time, rate: target.rate };
  }
  const behind = drift < 0;
  const nudging = Math.abs(local.rate - target.rate) > 0.001;
  if (apart > (nudging ? NUDGE_UNTIL_S : NUDGE_FROM_S) && !(behind && thin)) {
    return { play: true, rate: target.rate * (behind ? 1 + NUDGE : 1 - NUDGE) };
  }
  return { play: true, rate: target.rate };
}
