/**
 * The timing of the frame boost of the upscaler test page (labs/upscale/): which moment of the video each refresh of the screen shows, between which two
 * of the video's own frames that falls, and which refreshes get a new frame. Pure arithmetic, tested on its own (boostTiming.test.ts).
 */

/** One of the video's frames as the page got it: its moment in the video (seconds) and the page's time when it came (ms, the frame callback's `now`). */
export interface HeldFrame {
  mediaTime: number;
  arrived: number;
}

/** The longest step between two frames that is still interpolated: a longer one is a seek, a stall or a jump, and is shown as it is. */
export const LONGEST_STEP = 0.25;

/**
 * How long the clock remembers frames for (ms). Long, as the least late of the frames changes slowly: a 23.976 fps video on a 60 Hz screen comes 0 to 8
 * ms late in a cycle of about 8 seconds, and a clock that forgot the best of them would step back by up to 8 ms.
 */
const CLOCK_WINDOW = 10_000;

/** How far the clock may move a frame when what it knows changes (seconds): small, so that the boost's moments stay evenly apart. */
const CLOCK_SLEW = 0.0005;

/**
 * How far behind the clock may be before it jumps (seconds). The first frames after Play or a seek often come late (the decoder warming up), and a clock
 * that started from them and caught up at CLOCK_SLEW a frame would show the video seconds too late: past the boost's oldest frame, so that it only repeated
 * the video's own frames. Found on the RTX 3090: after the speed test's restarts the boost made 24 frames a second for the first 5 seconds.
 */
const CLOCK_JUMP = 0.004;

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

/**
 * The video's clock, worked out from its frames as they come. A frame is shown at the first refresh of the screen at or after its moment, never before,
 * so the frame that came the least late tells the clock best: the clock is the most of `mediaTime - arrived` over the last two seconds. (The frames
 * themselves come unevenly: a 24 fps video on a 60 Hz screen waits 2 and 3 refreshes in turn. The boost follows this clock, not their arrival, or it
 * would show that unevenness too.)
 */
export class VideoClock {
  private offsets: { arrived: number; offset: number }[] = [];
  private steps: number[] = [];
  private last: HeldFrame | undefined;
  /** The clock: the best of the offsets, followed a little at a time (see CLOCK_SLEW). */
  private offset = Number.NaN;

  add(frame: HeldFrame, rate = 1): void {
    const offset = frame.mediaTime - (frame.arrived / 1000) * rate;
    const step = this.last ? frame.mediaTime - this.last.mediaTime : Number.NaN;
    // A seek, a loop, a pause or a stall moves the clock (the frame is far later than the clock said): it starts again from this frame.
    const moved = !(step > 0 && step <= LONGEST_STEP) || (this.offsets.length > 0 && offset < this.best() - Math.max(0.1, 2 * this.frameTime()));
    if (moved) {
      this.offsets = [];
      this.steps = [];
    } else {
      this.steps.push(step);
      if (this.steps.length > 24) this.steps.shift();
    }
    this.offsets.push({ arrived: frame.arrived, offset });
    while (this.offsets.length > 1 && this.offsets[0]!.arrived < frame.arrived - CLOCK_WINDOW) this.offsets.shift();
    this.last = frame;
    const best = this.best();
    const behind = best - this.offset;
    this.offset = moved || !Number.isFinite(this.offset) || behind > CLOCK_JUMP ? best : this.offset + Math.min(CLOCK_SLEW, Math.max(-CLOCK_SLEW, behind));
  }

  private best(): number {
    return Math.max(...this.offsets.map((each) => each.offset));
  }

  /** Whether a frame has come since the clock last started. */
  running(): boolean {
    return this.offsets.length > 0;
  }

  /** The video's moment (seconds) at the page's time `now` (ms). */
  at(now: number, rate = 1): number {
    return this.offsets.length ? this.offset + (now / 1000) * rate : Number.NaN;
  }

  /** How long one of the video's frames lasts (seconds): the middle of its last steps; 0 before two frames in a row came. */
  frameTime(): number {
    return median(this.steps);
  }

  reset(): void {
    this.offsets = [];
    this.steps = [];
    this.last = undefined;
    this.offset = Number.NaN;
  }
}

/** How many of the video's frames the boost holds: the moment it shows is a frame and a refresh late (see `boostDelay`), which can be two frames back. */
export const HELD_FRAMES = 3;

/**
 * What the boost shows, from the frames it holds (oldest first): between `frames[from]` and `frames[to]`, `t` of the way (0 = the first, 1 = the
 * second). `between` false: nothing is made, `frames[to]` is shown as it is.
 */
export interface Phase {
  from: number;
  to: number;
  t: number;
  between: boolean;
}

/**
 * The phase for the moment `shown` (seconds of the video). Nothing is made between two frames that are not one step of the video apart (a seek, a loop,
 * a stall: the later one is held until its moment), nor for a video that already has `outFps` frames a second (its newest frame is shown at once).
 */
export function boostPhase(frames: readonly HeldFrame[], shown: number, outFps: number): Phase {
  const last = frames.length - 1;
  if (last < 1) return { from: Math.max(0, last), to: Math.max(0, last), t: 1, between: false };
  const newest = frames[last]!.mediaTime - frames[last - 1]!.mediaTime;
  if (!Number.isFinite(shown) || (newest > 0 && 1 / newest >= outFps * 0.99)) return { from: last - 1, to: last, t: 1, between: false };
  let from = last - 1;
  while (from > 0 && shown < frames[from]!.mediaTime) from--;
  const older = frames[from]!;
  const step = frames[from + 1]!.mediaTime - older.mediaTime;
  if (!(step > 0 && step <= LONGEST_STEP)) return { from, to: from + 1, t: 1, between: false };
  return { from, to: from + 1, t: Math.min(1, Math.max(0, (shown - older.mediaTime) / step)), between: true };
}

/**
 * How late the boost shows the video (seconds): one of its frames, as it needs the next frame to make the ones before it, and one refresh more, as a
 * frame can come up to a refresh later than the clock says.
 */
export const boostDelay = (frameTime: number, hz: number): number => frameTime + (hz > 0 ? 1 / hz : 1 / 60);

/** The screen's refresh rate (Hz) from the times between animation frames (ms); 0 when not known yet. Pauses (a page in the background) are left out. */
export function refreshRate(gaps: readonly number[]): number {
  const kept = gaps.filter((gap) => gap > 2 && gap < 100);
  if (kept.length < 10) return 0;
  return 1000 / median(kept);
}

/**
 * RIFE's frames are made ahead, for fixed moments of the video: every 1/rate of a second, `rate` being the boost's frames a second, or the screen's
 * refresh rate if it shows fewer (60 on a 57 Hz screen: 57).
 */
export const gridRate = (fps: number, hz: number): number => (hz > 0 && hz < fps * 0.99 ? hz : fps);

/** How far ahead of the screen RIFE starts on a pair of frames (s): RIFE takes 40-50 ms a frame on an RTX 3090 at 480p, two or three of them per pair at 60. */
export const RIFE_LEAD = 0.15;

/**
 * The moments RIFE has to make between the video's frames at `a` and `b` (s), on the grid of `rate` a second: grid number `m` (the moment m / rate) and
 * where it falls between them (`t`). A moment within 2% of a frame is that frame (made by nobody); a pair further apart than LONGEST_STEP gets none.
 */
export function gridJobs(a: number, b: number, rate: number): { m: number; t: number }[] {
  const step = b - a;
  if (!(step > 0 && step <= LONGEST_STEP) || !(rate > 0)) return [];
  const jobs: { m: number; t: number }[] = [];
  for (let m = Math.ceil(a * rate - 1e-9); m / rate < b; m++) {
    const t = (m / rate - a) / step;
    if (t > 0.02 && t < 0.98) jobs.push({ m, t });
  }
  return jobs;
}

/** The grid number of the moment `shown` (s): the screen shows the grid's moments, each on the refresh nearest it. */
export const gridMoment = (shown: number, rate: number): number => Math.round(shown * rate);

/**
 * Which refreshes of the screen get a new frame, for `fps` frames a second on a screen of `hz`: every one when the screen is not faster than that, else one
 * in every hz/fps, as evenly as the screen allows (60 fps on a 144 Hz screen is 2, 3, 2, 3, 2 refreshes). The slots are counted from the first refresh,
 * which sits a quarter into its slot, so that no refresh falls right on the edge of one (where a microsecond of jitter would skip a frame or show one
 * twice).
 */
export class Cadence {
  private anchor: number | undefined;
  private lastSlot = Number.NaN;
  private lastFps = 0;
  private lastHz = 0;

  tick(now: number, fps: number, hz: number): boolean {
    if (!(hz > 0) || fps >= hz * 0.95) return true;
    if (Math.abs(fps - this.lastFps) > 0.01 || Math.abs(hz - this.lastHz) > 2) {
      this.anchor = undefined;
      this.lastFps = fps;
      this.lastHz = hz;
    }
    const frames = (now / 1000) * fps;
    this.anchor ??= frames - Math.floor(frames) - 0.25;
    const slot = Math.floor(frames - this.anchor);
    if (slot === this.lastSlot) return false;
    this.lastSlot = slot;
    return true;
  }

  reset(): void {
    this.anchor = undefined;
    this.lastSlot = Number.NaN;
  }
}
