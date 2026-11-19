import { cuesMoved } from "./hold";

export interface EditableCue {
  startTime: number;
  endTime: number;
}

interface Times {
  start: number;
  end: number;
}

export class CueEditor<T extends EditableCue> {
  private readonly originals: Times[];
  private readonly waiting = new Map<number, Times>();
  private moved = false;

  constructor(
    readonly cues: readonly T[],
    known?: ReadonlyMap<T, Times>,
  ) {
    this.originals = cues.map((cue) => known?.get(cue) ?? { start: cue.startTime, end: cue.endTime });
  }

  get changed(): boolean {
    return this.moved;
  }

  snapshot(): Map<T, Times> {
    return new Map(this.cues.map((cue, index) => [cue, this.originals[index] as Times]));
  }

  original(index: number): Times {
    return this.originals[index] as Times;
  }

  current(index: number): Times {
    const cue = this.cues[index] as T;
    return { start: cue.startTime, end: cue.endTime };
  }

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

  flush(now: number): void {
    for (const [index, times] of this.waiting) {
      const cue = this.cues[index];
      if (!cue || (cue.startTime <= now && now < cue.endTime)) continue;
      this.waiting.delete(index);
      this.write(cue, times.start, times.end);
    }
  }

  restore(): void {
    this.waiting.clear();
    this.cues.forEach((cue, index) => this.write(cue, (this.originals[index] as Times).start, (this.originals[index] as Times).end));
    this.moved = false;
  }

  private write(cue: T, start: number, end: number): void {
    if (cue.startTime === start && cue.endTime === end) return;
    if (start > cue.endTime) {
      cue.endTime = end;
      cue.startTime = start;
    } else {
      cue.startTime = start;
      cue.endTime = end;
    }
    this.moved = true;
    cuesMoved();
  }
}
