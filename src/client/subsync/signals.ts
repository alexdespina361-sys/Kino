import { SILERO_STEP, type Silero } from "./silero";

export interface Word {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export const SAMPLE_RATE = 16000;
const STEP_SECONDS = SILERO_STEP / SAMPLE_RATE;
const JOIN_TOLERANCE = 0.06;

interface Stretch {
  from: number;
  samples: number;
  steps: number[];
  carry: Float32Array;
  memory: Float32Array;
}

export interface Range {
  from: number;
  to: number;
}

export class Signals {
  private readonly stretches: Stretch[] = [];
  private words: Word[] = [];
  private heard: Range[] = [];
  private active: Stretch | undefined;

  constructor(private readonly vad: Pick<Silero, "step" | "reset" | "save" | "restore">) {}

  addAudio(time: number, pcm: Float32Array): boolean {
    const end = time + pcm.length / SAMPLE_RATE;
    let stretch = this.stretches.find((s) => Math.abs(time - this.endOf(s)) <= JOIN_TOLERANCE);
    if (!stretch) {
      if (this.stretches.some((s) => time >= s.from - JOIN_TOLERANCE && end <= this.endOf(s) + JOIN_TOLERANCE)) return false;
      const overlapped = this.stretches.find((s) => time > s.from && time < this.endOf(s) - JOIN_TOLERANCE);
      if (overlapped) {
        const skip = Math.round((this.endOf(overlapped) - time) * SAMPLE_RATE);
        if (skip >= pcm.length) return false;
        return this.addAudio(this.endOf(overlapped), pcm.subarray(skip));
      }
      stretch = { from: time, samples: 0, steps: [], carry: new Float32Array(0), memory: new Float32Array(0) };
      this.stretches.push(stretch);
      this.stretches.sort((a, b) => a.from - b.from);
    }
    const gap = Math.round((time - this.endOf(stretch)) * SAMPLE_RATE);
    let audio = pcm;
    if (gap > 0) {
      audio = new Float32Array(gap + pcm.length);
      audio.set(pcm, gap);
    } else if (gap < 0) audio = pcm.subarray(Math.min(pcm.length, -gap));
    this.run(stretch, audio);
    return true;
  }

  private endOf(stretch: Stretch): number {
    return stretch.from + stretch.samples / SAMPLE_RATE;
  }

  private run(stretch: Stretch, pcm: Float32Array): void {
    if (this.active !== stretch) {
      if (this.active) this.active.memory = this.vad.save();
      if (stretch.memory.length > 0) this.vad.restore(stretch.memory);
      else this.vad.reset();
      this.active = stretch;
    }
    let audio = pcm;
    if (stretch.carry.length > 0) {
      audio = new Float32Array(stretch.carry.length + pcm.length);
      audio.set(stretch.carry, 0);
      audio.set(pcm, stretch.carry.length);
    }
    const whole = Math.floor(audio.length / SILERO_STEP);
    for (let k = 0; k < whole; k++) stretch.steps.push(this.vad.step(audio, k * SILERO_STEP));
    stretch.carry = audio.slice(whole * SILERO_STEP);
    stretch.samples += pcm.length;
  }

  addWords(words: readonly Word[], from: number, to: number): void {
    this.words = this.words.filter((w) => w.start < from || w.start >= to);
    this.words.push(...words.filter((w) => w.start >= from && w.start < to));
    this.words.sort((a, b) => a.start - b.start);
    this.heard = mergeRanges([...this.heard, { from, to }]);
  }

  clear(): void {
    this.stretches.length = 0;
    this.words = [];
    this.heard = [];
    this.active = undefined;
    this.vad.reset();
  }

  stretchAt(time: number): Range | undefined {
    const spans = this.stretches.map((s) => ({ from: s.from, to: this.endOf(s) }));
    return spans.find((s) => time >= s.from - 1 && time <= s.to + 1);
  }

  probability(from: number, count: number): Float32Array {
    const out = new Float32Array(count);
    const stretch = this.stretches.find((s) => from >= s.from - 1e-6 && from < this.endOf(s) + 1e-6) ?? this.stretches.find((s) => s.from > from && s.from < from + count * 0.01);
    if (!stretch || stretch.steps.length === 0) return out;
    const last = stretch.steps.length - 1;
    const first = Math.round((from - stretch.from) / 0.01);
    for (let i = 0; i < count; i++) {
      const x = ((first + i) * 0.01) / STEP_SECONDS - 0.5;
      if (x < -1 || x > last + 1) continue;
      const a = Math.max(0, Math.min(last, Math.floor(x)));
      const z = Math.min(last, a + 1);
      const f = Math.max(0, x - a);
      out[i] = (stretch.steps[a] as number) * (1 - f) + (stretch.steps[z] as number) * f;
    }
    return out;
  }

  wordsIn(from: number, to: number): { words: Word[]; heardSeconds: number; ranges: Range[] } {
    const ranges: Range[] = [];
    let heardSeconds = 0;
    for (const range of this.heard) {
      const a = Math.max(from, range.from);
      const b = Math.min(to, range.to);
      if (b > a) {
        ranges.push({ from: a, to: b });
        heardSeconds += b - a;
      }
    }
    return { words: this.words.filter((w) => w.start >= from && w.start < to), heardSeconds, ranges };
  }

  get wordCount(): number {
    return this.words.length;
  }
}

export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.from <= last.to + 0.001) last.to = Math.max(last.to, range.to);
    else out.push({ ...range });
  }
  return out;
}
