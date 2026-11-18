export interface SyncTarget {
  playing: boolean;
  time: number;
  rate: number;
  waiting?: boolean;
  settled?: boolean;
}

export interface SyncLocal {
  playing: boolean;
  time: number;
  rate: number;
  buffering: boolean;
  ahead: number;
  targetBuffered: boolean;
}

export interface SyncStep {
  play: boolean;
  seek?: number;
  rate: number;
}

export function leaderNow(report: { playing: boolean; time: number; rate: number; lag?: number | undefined }): number {
  return report.playing ? report.time + (report.lag ?? 0) * report.rate : report.time;
}

export const HARD_SEEK_S = 1;
export const NUDGE_FROM_S = 0.25;
export const NUDGE_UNTIL_S = 0.08;
export const NUDGE = 0.06;
export const PAUSED_TOLERANCE_S = 0.1;
export const WAIT_TOLERANCE_S = 2;
export const FAR_SEEK_S = 8;
export const RESUME_SEEK_S = 0.1;
export const SEEK_COOLDOWN_MS = 3000;
export const LEAD_FROM_PLAYING_S = 0.07;
export const LEAD_FROM_STILL_S = 0.1;
export const LEAD_MAX_S = NUDGE_FROM_S;
export const LEAD_GAIN = 0.6;
export const LEAD_LOOK_AFTER_S = 1;
export const LEAD_LOOK_UNTIL_S = 20;
export const LEAD_LEARN_UNTIL_S = HARD_SEEK_S;
export const THIN_BUFFER_S = 4;
export const GIVE_UP_S = 15;

export function syncStep(target: SyncTarget, local: SyncLocal, msSinceSeek: number): SyncStep {
  const drift = local.time - target.time;
  const apart = Math.abs(drift);
  if (!target.playing) {
    const tolerance = target.waiting ? WAIT_TOLERANCE_S : PAUSED_TOLERANCE_S;
    return { play: false, rate: target.rate, ...(apart > tolerance ? { seek: target.time } : {}) };
  }
  const thin = local.playing && (local.buffering || local.ahead < THIN_BUFFER_S);
  const unsure = drift > 0 && target.settled === false && apart < FAR_SEEK_S;
  if (apart > HARD_SEEK_S && !unsure && msSinceSeek > SEEK_COOLDOWN_MS && (!thin || local.targetBuffered || apart > GIVE_UP_S)) {
    return { play: true, seek: target.time, rate: target.rate };
  }
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

export interface HostReport {
  playing: boolean;
  time: number;
  rate: number;
  lag?: number | undefined;
  waiting?: boolean | undefined;
}

export const CLOCK_WINDOW_S = 12;
export const CLOCK_DOUBT_S = 0.4;
export const CLOCK_AGREE_S = 0.5;
export const CLOCK_CONFIRM_S = 0.5;
export const CLOCK_RISING_S = 0.1;

export class HostClock {
  private samples: Array<{ anchor: number; at: number }> = [];
  private doubt: { anchor: number; at: number } | null = null;
  private rate = 1;
  private starting = false;

  reset(): void {
    this.samples = [];
    this.doubt = null;
  }

  get settled(): boolean {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    return first !== undefined && last !== undefined && last.at - first.at >= CLOCK_CONFIRM_S;
  }

  read(report: HostReport, now: number): number {
    if (!report.playing) {
      this.reset();
      this.starting = !report.waiting;
      return report.time;
    }
    if (report.rate !== this.rate) {
      this.reset();
      this.rate = report.rate;
    }
    const anchor = report.time + (report.lag ?? 0) * report.rate - report.rate * now;
    if (this.starting) {
      this.starting = false;
      return anchor + report.rate * now;
    }
    this.samples = this.samples.filter((sample) => now - sample.at < CLOCK_WINDOW_S);
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

  private spread(): number {
    if (this.samples.length < 2) return 0;
    return this.furthest() - this.samples.reduce((least, sample) => Math.min(least, sample.anchor), Infinity);
  }
}

type JumpKind = "playing" | "still";

export const syncStats = { reports: 0, seeks: 0, rewinds: 0, speedChanges: 0, waits: 0, drift: 0, settled: false, leadPlaying: LEAD_FROM_PLAYING_S, leadStill: LEAD_FROM_STILL_S };

export function describeSync(stats: typeof syncStats): string | null {
  if (stats.reports === 0) return null;
  const drift = `${stats.drift >= 0 ? "+" : "−"}${Math.abs(stats.drift).toFixed(2)}s`;
  const lead = `${Math.round(stats.leadPlaying * 1000)}/${Math.round(stats.leadStill * 1000)} ms`;
  return `sync: ${stats.reports} reports  now ${drift} from the host${stats.settled ? "" : " (not settled)"}  jumps ${stats.seeks} (${stats.rewinds} back)  speed changes ${stats.speedChanges}  host waits ${stats.waits}  jumps aimed on by ${lead} (playing/paused)`;
}

export class Follower {
  private readonly clock = new HostClock();
  private lastSeekAt = -Infinity;
  private readonly lead: Record<JumpKind, number> = { playing: LEAD_FROM_PLAYING_S, still: LEAD_FROM_STILL_S };
  private pending: { at: number; kind: JumpKind } | null = null;

  reset(): void {
    this.clock.reset();
    this.pending = null;
  }

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
        const kind = local.playing ? "playing" : "still";
        step.seek = Math.max(0, step.seek + this.lead[kind] * report.rate);
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

  private learn(report: HostReport, local: Omit<SyncLocal, "targetBuffered">, time: number, settled: boolean, now: number): void {
    const pending = this.pending;
    if (!pending) return;
    const age = now - pending.at;
    if (!report.playing || age > LEAD_LOOK_UNTIL_S) {
      this.pending = null;
      return;
    }
    if (age < LEAD_LOOK_AFTER_S || !settled || !local.playing || local.buffering) return;
    this.pending = null;
    const missed = (time - local.time) / report.rate;
    if (Math.abs(missed) > LEAD_LEARN_UNTIL_S) return;
    this.lead[pending.kind] = Math.min(LEAD_MAX_S, Math.max(-LEAD_MAX_S, this.lead[pending.kind] + LEAD_GAIN * missed));
  }
}
