/** Where the TV being followed is, as the server relays it. */
export interface SyncTarget {
  playing: boolean;
  time: number;
  rate: number;
  /** Not playing only because it waits for data (the host's picture ran dry), not because anybody paused it. */
  waiting?: boolean;
  /** Where it is has been read from reports that agree (see `HostClock`); false (a read from one report) is not enough to send a picture back in time. */
  settled?: boolean;
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
 * the guess being a little off, and a picture that has just started needs a moment to move, so a nudge starts well beyond that (a quarter
 * of a second apart is not something two screens in two rooms show), and then goes on until the pictures are close (`NUDGE_UNTIL_S`),
 * instead of starting and stopping with every report. The speed is changed as little as will do: a change of speed is what a viewer notices.
 */
export const NUDGE_FROM_S = 0.25;
export const NUDGE_UNTIL_S = 0.08;
export const NUDGE = 0.06;
/** A paused picture only needs to be near, since nothing moves (but near enough to show the same frame). */
export const PAUSED_TOLERANCE_S = 0.1;
/**
 * A host that only waits for data (its picture ran dry, nobody paused it) is waited for where the picture is: sent back to the host's
 * frame, a guest would jump for every hiccup of the host's, and then play on from there a moment behind. Only one that is farther from
 * the host than this goes to it (it has that place to download anyway).
 */
export const WAIT_TOLERANCE_S = 2;
/**
 * A picture that is ahead of where the host is read to be is sent back in time only once that read is `settled`, or when it is this far
 * ahead, which no late report explains: a report that was held up on the way makes the host look behind, and a jump back on its word
 * has to be undone, by a jump forward, a moment later.
 */
export const FAR_SEEK_S = 8;
/**
 * A picture that is not playing when the leader is (a guest whose host has just started again) goes to the place at once if it is this
 * far from it and already has it: nothing to download, and nothing moving that the jump would disturb. Otherwise it would start about
 * a report's age behind and spend seconds catching up.
 */
export const RESUME_SEEK_S = 0.1;
/** After a jump the picture needs a moment to fill; a second jump before then would only chase it. */
export const SEEK_COOLDOWN_MS = 3000;
/**
 * A picture sent to a place shows it a moment later, and the host has moved on by then: left to itself, a guest lands behind the host by that
 * moment, every time, and stays there (it is inside what is not worth a nudge, so nothing ever puts it right). The moment is not the same for
 * every screen, nor for every kind of jump: one that starts a picture moving (a guest that was paused) takes longer than one that carries on,
 * and a host that is slow to start moving, itself, makes it shorter. So a guest does not guess it: it looks at how far from the host each jump
 * left it, and aims that much further on (or less far) the next time it jumps (`Follower`). These are what it starts from, before it has seen
 * any (seconds, for a picture at normal speed; what a desktop browser was measured to take: a jump landed 60-75 ms behind the host, and a
 * jump that starts a paused picture 120-150 ms, of which the host's own slowness to start is some 70), and the most that it will ever aim
 * off by: no more than a nudge is for, so that a lead that is wrong is never what starts one.
 */
export const LEAD_FROM_PLAYING_S = 0.07;
export const LEAD_FROM_STILL_S = 0.1;
export const LEAD_MAX_S = NUDGE_FROM_S;
/** How much of what a jump was found to have missed by is put into the next one (the place the host is read at is a little noisy, so not all of it). */
export const LEAD_GAIN = 0.6;
/** A jump is looked at by the first report this long after it (its picture has had time to start), and given up on after this long. */
export const LEAD_LOOK_AFTER_S = 1;
export const LEAD_LOOK_UNTIL_S = 20;
/** Missing by as much as a hard jump is for is not what a jump takes: the picture waited for data, or the host jumped too. It teaches nothing. */
export const LEAD_LEARN_UNTIL_S = HARD_SEEK_S;
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
    const tolerance = target.waiting ? WAIT_TOLERANCE_S : PAUSED_TOLERANCE_S;
    return { play: false, rate: target.rate, ...(apart > tolerance ? { seek: target.time } : {}) };
  }
  // (A picture that is not playing yet has nothing to run dry: it goes straight to the place, as a screen that has just joined must.)
  const thin = local.playing && (local.buffering || local.ahead < THIN_BUFFER_S);
  const unsure = drift > 0 && target.settled === false && apart < FAR_SEEK_S;
  if (apart > HARD_SEEK_S && !unsure && msSinceSeek > SEEK_COOLDOWN_MS && (!thin || local.targetBuffered || apart > GIVE_UP_S)) {
    return { play: true, seek: target.time, rate: target.rate };
  }
  // (Only a picture that is behind goes to the place at once. One that is ahead plays on, a little slower, until the host is where it is: no jump back.)
  if (!local.playing && drift < 0 && apart > RESUME_SEEK_S && local.targetBuffered && msSinceSeek > SEEK_COOLDOWN_MS) {
    return { play: true, seek: target.time, rate: target.rate };
  }
  const behind = drift < 0;
  const nudging = Math.abs(local.rate - target.rate) > 0.001;
  if (apart > (nudging ? NUDGE_UNTIL_S : NUDGE_FROM_S) && !(behind && thin)) {
    return { play: true, rate: target.rate * (behind ? 1 + NUDGE : 1 - NUDGE) };
  }
  return { play: true, rate: target.rate };
}

/** One report of the host, as a guest gets it (`TV_SYNC`). */
export interface HostReport {
  playing: boolean;
  time: number;
  rate: number;
  lag?: number | undefined;
  waiting?: boolean | undefined;
}

/** How long the reports of a host that plays are kept, to read where it is from the least delayed of them (seconds). */
export const CLOCK_WINDOW_S = 12;
/** A report this far behind what the recent ones say is in doubt: it may have been held up on the way, or the host may have gone back. */
export const CLOCK_DOUBT_S = 0.4;
/** Two reports in doubt that say the same (to within this) are one late delivery, or the host having gone back... */
export const CLOCK_AGREE_S = 0.5;
/** ...and are the host having gone back only if they came this far apart (seconds): late ones that were held up together come together... */
export const CLOCK_CONFIRM_S = 0.5;
/** ...and only if the second is not later than the first by more than this: reports that are less late one after another are a queue emptying. */
export const CLOCK_RISING_S = 0.1;

/**
 * Where the host is, read from its recent reports instead of its last. Every report is late by what its way took, and that varies from
 * one report to the next (a phone on a mobile network more than a screen on a wire), but it is never early: of the reports of the last
 * seconds, the one that is furthest on is the one that was held up least, and the one to read the host's place from. Going by the last
 * report alone, a guest on a poor link was always being told it was a little ahead or behind, and was made to play faster, slower, or
 * to jump, every few seconds. A report that is well behind the others is held back until a second one, from a later moment, says the
 * same: the host has then gone back (it jumped back in the film), and what was read before is of no use.
 */
export class HostClock {
  private samples: Array<{ anchor: number; at: number }> = [];
  private doubt: { anchor: number; at: number } | null = null;
  private rate = 1;
  /** The last report was of a host that holds still: the next one that says it plays is the moment it was told to, not yet a place on its clock. */
  private starting = false;

  /** What was read is of no use any more (another film, another speed). */
  reset(): void {
    this.samples = [];
    this.doubt = null;
  }

  /** Whether the place it says is read from reports that came a moment apart and agree. */
  get settled(): boolean {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    return first !== undefined && last !== undefined && last.at - first.at >= CLOCK_CONFIRM_S;
  }

  /** Where the host is at `now` (seconds, on a clock that only goes on), given the report that has just arrived. */
  read(report: HostReport, now: number): number {
    if (!report.playing) {
      this.reset(); // a host that holds still has a place, not a clock to read
      this.starting = !report.waiting; // (one that only waits for data starts again at once, with nothing to wait for first)
      return report.time;
    }
    if (report.rate !== this.rate) {
      this.reset();
      this.rate = report.rate;
    }
    // The anchor of a report is where the host would have been when this page's clock read zero, had it played at that speed all along:
    // reports of a host that plays have the same anchor, whatever time they came at, except for what held each of them up.
    const anchor = report.time + (report.lag ?? 0) * report.rate - report.rate * now;
    if (this.starting) {
      // The host was told to play and says so at once, but its picture takes a moment to start moving (more on some screens than on others): this
      // report is ahead of the host's clock by that moment, and the furthest report is the one that is read from, for as long as it is kept.
      // Read from, it would have every guest play ahead of the host by that much, and then slow down when it was forgotten. It is used for what
      // it says (the place to start from) and left out of the clock, which the reports after it make.
      this.starting = false;
      return anchor + report.rate * now;
    }
    this.samples = this.samples.filter((sample) => now - sample.at < CLOCK_WINDOW_S);
    // (How far a late report is behind the rest has to be more than how much they differ among themselves: on a link whose reports are
    // all late by something different, a report that is merely later than most is no sign of anything.)
    if (anchor < this.furthest() - Math.max(CLOCK_DOUBT_S, 2 * this.spread())) {
      const doubt = this.doubt;
      if (!doubt || Math.abs(anchor - doubt.anchor) >= CLOCK_AGREE_S || anchor > doubt.anchor + CLOCK_RISING_S) this.doubt = { anchor, at: now };
      else if (now - doubt.at >= CLOCK_CONFIRM_S) {
        this.samples = [doubt, { anchor, at: now }];
        this.doubt = null;
      }
    } else {
      this.doubt = null;
      this.samples.push({ anchor, at: now });
    }
    return this.furthest() + report.rate * now;
  }

  private furthest(): number {
    return this.samples.reduce((most, sample) => Math.max(most, sample.anchor), -Infinity);
  }

  /** How much the reports kept differ among themselves (the holding-up of each is what differs). */
  private spread(): number {
    if (this.samples.length < 2) return 0;
    return this.furthest() - this.samples.reduce((least, sample) => Math.min(least, sample.anchor), Infinity);
  }
}

/** A jump of a picture that was playing (it carries on from the new place), or of one that was not (it has to start there). */
type JumpKind = "playing" | "still";

/**
 * What a follower has done on this page, for the `?debug` panel: a picture that lags is told apart from one that only looks like it. And how far
 * on it aims a jump (seconds, for a picture that was playing and for one that was not): what this screen has been found to take to land one.
 */
export const syncStats = { reports: 0, seeks: 0, rewinds: 0, speedChanges: 0, waits: 0, drift: 0, settled: false, leadPlaying: LEAD_FROM_PLAYING_S, leadStill: LEAD_FROM_STILL_S };

/** The follower's doings in a line, or null while it has done nothing (this page follows nobody). */
export function describeSync(stats: typeof syncStats): string | null {
  if (stats.reports === 0) return null;
  const drift = `${stats.drift >= 0 ? "+" : "−"}${Math.abs(stats.drift).toFixed(2)}s`;
  const lead = `${Math.round(stats.leadPlaying * 1000)}/${Math.round(stats.leadStill * 1000)} ms`;
  return `sync: ${stats.reports} reports  now ${drift} from the host${stats.settled ? "" : " (not settled)"}  jumps ${stats.seeks} (${stats.rewinds} back)  speed changes ${stats.speedChanges}  host waits ${stats.waits}  jumps aimed on by ${lead} (playing/paused)`;
}

/**
 * A guest's way of keeping its picture with the host's: what to do about each report (`TV_SYNC`). Reads the host's place with a `HostClock`,
 * remembers when it last jumped (a second jump before the first has filled would only chase it), aims its jumps at where the host will be
 * when they land (`LEAD_*`), and keeps `syncStats`.
 */
export class Follower {
  private readonly clock = new HostClock();
  private lastSeekAt = -Infinity;
  /**
   * How long a jump of each kind has been found to take to land, in seconds. The two kinds are told apart by whether the picture was playing
   * when it jumped. Kept for as long as this page is open, film after film: it is a thing about this screen.
   */
  private readonly lead: Record<JumpKind, number> = { playing: LEAD_FROM_PLAYING_S, still: LEAD_FROM_STILL_S };
  /** The last jump to a host that plays, until it has been looked at (what it missed by is how long the next one has to aim on). */
  private pending: { at: number; kind: JumpKind } | null = null;

  /** A different film: where the host was in the one before says nothing about this one. */
  reset(): void {
    this.clock.reset();
    this.pending = null;
  }

  /** `now` is a clock that only goes on, in seconds (`performance.now() / 1000`); `hasBuffered` says whether a place in the film is downloaded here. */
  step(report: HostReport, local: Omit<SyncLocal, "targetBuffered">, now: number, hasBuffered: (time: number) => boolean): SyncStep {
    const time = this.clock.read(report, now);
    const settled = this.clock.settled;
    this.learn(report, local, time, settled, now);
    const targetBuffered = hasBuffered(time);
    const step = syncStep(
      { playing: report.playing, time, rate: report.rate, waiting: report.waiting === true, settled },
      { ...local, targetBuffered },
      (now - this.lastSeekAt) * 1000,
    );
    if (step.seek !== undefined) {
      this.lastSeekAt = now;
      if (report.playing) {
        // The host moves on while the picture lands, so the jump goes to where it will be then. (A host that holds still does not move on.)
        const kind = local.playing ? "playing" : "still";
        step.seek = Math.max(0, step.seek + this.lead[kind] * report.rate);
        // (A place that is not downloaded is landed at when it has been: how long that takes says nothing of how long a jump takes.)
        this.pending = targetBuffered ? { at: now, kind } : null;
      }
    }
    syncStats.reports += 1;
    syncStats.drift = local.time - time;
    syncStats.settled = settled;
    syncStats.leadPlaying = this.lead.playing;
    syncStats.leadStill = this.lead.still;
    if (step.seek !== undefined) {
      syncStats.seeks += 1;
      if (step.seek < local.time) syncStats.rewinds += 1;
    }
    if (report.playing && Math.abs(step.rate - local.rate) > 0.001) syncStats.speedChanges += 1;
    if (report.waiting && local.playing && !step.play) syncStats.waits += 1;
    return step;
  }

  /** Looks at how far from the host the last jump left this picture, once it is playing, and takes what it missed by into the next one. */
  private learn(report: HostReport, local: Omit<SyncLocal, "targetBuffered">, time: number, settled: boolean, now: number): void {
    const pending = this.pending;
    if (!pending) return;
    const age = now - pending.at;
    if (!report.playing || age > LEAD_LOOK_UNTIL_S) {
      this.pending = null; // (the host stopped, or this took too long to be what a jump takes)
      return;
    }
    if (age < LEAD_LOOK_AFTER_S || !settled || !local.playing || local.buffering) return;
    this.pending = null;
    const missed = (time - local.time) / report.rate; // positive: still behind the host, so the jump should have aimed on
    if (Math.abs(missed) > LEAD_LEARN_UNTIL_S) return;
    this.lead[pending.kind] = Math.min(LEAD_MAX_S, Math.max(-LEAD_MAX_S, this.lead[pending.kind] + LEAD_GAIN * missed));
  }
}
