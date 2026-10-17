/** What of a subtitle line the page can move: the browser's own cue objects have these. */
export interface EditableCue {
  startTime: number;
  endTime: number;
}

interface Times {
  start: number;
  end: number;
}

/**
 * Moves the lines of one subtitle track to where the aligner put them, and back. A line that is on screen is not touched (it would
 * jump while it is read); its new place is kept and given once it is gone. The file's own times are kept so that turning the aligner
 * off puts everything back.
 */
export class CueEditor<T extends EditableCue> {
  private readonly originals: Times[];
  private readonly waiting = new Map<number, Times>();
  private moved = false;

  /** `known`: the file's times of lines that were in an editor before (when the list of lines is made again and some are the same objects). */
  constructor(
    readonly cues: readonly T[],
    known?: ReadonlyMap<T, Times>,
  ) {
    this.originals = cues.map((cue) => known?.get(cue) ?? { start: cue.startTime, end: cue.endTime });
  }

  get changed(): boolean {
    return this.moved;
  }

  /** The file's times by line, to hand to a new editor. */
  snapshot(): Map<T, Times> {
    return new Map(this.cues.map((cue, index) => [cue, this.originals[index] as Times]));
  }

  original(index: number): Times {
    return this.originals[index] as Times;
  }

  /** Where line `index` is now. */
  current(index: number): Times {
    const cue = this.cues[index] as T;
    return { start: cue.startTime, end: cue.endTime };
  }

  /** Put line `index` at `start`..`end`. False when it is on screen at `now` and has to wait. */
  place(index: number, start: number, end: number, now: number): boolean {
    const cue = this.cues[index];
    if (!cue) return true;
    if (cue.startTime <= now && now < cue.endTime && (start > now || end <= now)) {
      this.waiting.set(index, { start, end });
      return false;
    }
    this.waiting.delete(index);
    this.write(cue, start, end);
    return true;
  }

  /** Give the lines that had to wait their places, those that are off screen now. */
  flush(now: number): void {
    for (const [index, times] of this.waiting) {
      const cue = this.cues[index];
      if (!cue || (cue.startTime <= now && now < cue.endTime)) continue;
      this.waiting.delete(index);
      this.write(cue, times.start, times.end);
    }
  }

  /** Every line back at the time the file gave it. */
  restore(): void {
    this.waiting.clear();
    this.cues.forEach((cue, index) => this.write(cue, (this.originals[index] as Times).start, (this.originals[index] as Times).end));
    this.moved = false;
  }

  private write(cue: T, start: number, end: number): void {
    if (cue.startTime === start && cue.endTime === end) return;
    // (A line moving later is given its end first, so that it never ends before it starts.)
    if (start > cue.endTime) {
      cue.endTime = end;
      cue.startTime = start;
    } else {
      cue.startTime = start;
      cue.endTime = end;
    }
    this.moved = true;
  }
}
