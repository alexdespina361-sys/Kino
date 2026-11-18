import { heardRate, MIN_HEARD_RATE } from "./pick";
import { mergeRanges, type Range, type Signals, type Word } from "./signals";
import { AsrAnchor, Timing2, type Anchor } from "./vendor/subtitle-sync.js";
import { plainText, type Cue } from "./cues";

export const WINDOW_WITH_WORDS = 60;
export const WINDOW_VOICE_ONLY = 150;
const LEFT_GUARD = 10;
const RIGHT_GUARD = 2;
const MIN_WORDS = 12;
const MIN_PROBE = 3;
const PROBE_RANGE = 90;
const MIN_SHARE = 0.3;
const MAX_SPREAD = 20;

const C = AsrAnchor.combinedNext;

export type Method = "whistle+silero" | "dub" | "silero" | "none";

export interface Update {
  index: number;
  start: number;
  end: number;
}

export interface Outcome {
  method: Method;
  updates: Update[];
  shift: number | null;
  anchored: number;
  covered: number;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const k = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[k] as number) : ((sorted[k - 1] as number) + (sorted[k] as number)) / 2;
};

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
};

const heardStart = (anchor: Anchor): number | null => (anchor.accepted && anchor.start !== null ? anchor.start - (anchor.skipSyl ? Math.min(1.5, anchor.skipSyl / 5.5) : 0) : null);

export class TrackSolver {
  private readonly input: Cue[];
  private readonly starts: number[];
  private shift: number | null = null;
  private failedAt = 0;
  private dubbed = false;
  private solved: Range[] = [];

  constructor(
    cues: readonly Cue[],
    private readonly useWords: boolean,
  ) {
    this.input = cues.map((cue) => ({ start: cue.start, end: cue.end, text: plainText(cue.text) }));
    this.starts = this.input.map((cue) => cue.start);
  }

  get offset(): number | null {
    return this.shift;
  }

  forget(): void {
    this.shift = null;
    this.failedAt = 0;
    this.dubbed = false;
    this.solved = [];
  }

  private within(from: number, to: number): number[] {
    let low = 0;
    let high = this.starts.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((this.starts[mid] as number) < from) low = mid + 1;
      else high = mid;
    }
    const out: number[] = [];
    for (let i = low; i < this.starts.length && (this.starts[i] as number) <= to; i++) out.push(i);
    return out;
  }

  private probe(words: readonly Word[], from: number, to: number): number | null {
    const centre = this.shift ?? 0;
    const indices = this.within(from - centre - PROBE_RANGE, to - centre + PROBE_RANGE);
    if (indices.length === 0) return null;
    const anchors = AsrAnchor.anchors(
      indices.map((i) => this.input[i] as Cue),
      words,
      C.anchors,
    );
    const offsets: number[] = [];
    anchors.forEach((anchor, k) => {
      const heard = heardStart(anchor);
      if (heard !== null) offsets.push(heard - (this.input[indices[k] as number] as Cue).start);
    });
    return offsets.length >= MIN_PROBE ? median(offsets) : null;
  }

  solve(signals: Signals, end: number): Outcome {
    const none: Outcome = { method: "none", updates: [], shift: this.shift, anchored: 0, covered: 0 };
    const stretch = signals.stretchAt(end);
    if (!stretch || this.input.length === 0) return none;
    const to = Math.min(end, stretch.to);
    const narrow = this.useWords && !this.dubbed && signals.wordsIn(to - WINDOW_WITH_WORDS, to).words.length >= MIN_WORDS;
    const from = Math.max(stretch.from, to - (narrow ? WINDOW_WITH_WORDS : WINDOW_VOICE_ONLY));
    if (to - from < 20) return none;

    const heard = this.useWords ? signals.wordsIn(from, to) : { words: [], heardSeconds: 0, ranges: [] };
    const words = heard.words.length >= MIN_WORDS;
    if (words && (this.shift === null || heard.words.length > this.failedAt * 1.5)) {
      const found = this.probe(heard.words, from, to);
      if (found !== null) {
        this.shift = found;
        this.failedAt = 0;
      } else this.failedAt = Math.max(1, heard.words.length);
    }

    const shift = this.shift ?? 0;
    const indices = this.within(from - shift, to - shift - RIGHT_GUARD);
    if (indices.length === 0) return { ...none, shift: this.shift };
    const cues: Cue[] = indices.map((i) => {
      const cue = this.input[i] as Cue;
      return { start: cue.start + shift - from, end: cue.end + shift - from, text: cue.text };
    });
    const silero = signals.probability(from, Math.floor((to - from) / 0.01));
    const base = Timing2.align(cues, silero, {}, {}).cues;

    let out = base;
    let method: Method = "silero";
    let anchored = 0;
    let covered = 0;
    if (words) {
      const relative = heard.words.map((w) => ({ ...w, start: w.start - from, end: w.end - from }));
      const anchors = AsrAnchor.anchors(cues, relative, C.anchors);
      const listened = heard.ranges.map((r) => ({ from: r.from - from, to: r.to - from }));
      cues.forEach((cue, k) => {
        if (!listened.some((r) => cue.start >= r.from - 1 && cue.start <= r.to + 1)) return;
        covered++;
        if ((anchors[k] as Anchor).accepted) anchored++;
      });
      if (covered >= MIN_PROBE && anchored / covered >= MIN_SHARE) {
        out = AsrAnchor.place(cues, anchors, silero, { ...C.place, base });
        method = "whistle+silero";
      } else if (covered >= MIN_PROBE && heardRate(heard.words, heard.heardSeconds) >= MIN_HEARD_RATE) {
        out = AsrAnchor.dub(cues, relative, silero).cues;
        method = "dub";
      }
    }

    if (method === "dub") this.dubbed = true;
    else if (method === "whistle+silero") this.dubbed = false;

    const moves = out.map((cue, k) => cue.start - (cues[k] as Cue).start);
    if (moves.length >= 5 && percentile(moves, 0.9) - percentile(moves, 0.1) > MAX_SPREAD) return { ...none, shift: this.shift };
    if (moves.length >= MIN_PROBE) this.shift = shift + median(moves);

    const guarded = from > stretch.from && this.solved.some((r) => r.from <= from && r.to >= from + LEFT_GUARD);
    const lowest = from + (guarded ? LEFT_GUARD : 0);
    const updates: Update[] = [];
    out.forEach((cue, k) => {
      const start = cue.start + from;
      if (start < lowest || start > to - RIGHT_GUARD) return;
      updates.push({ index: indices[k] as number, start, end: Math.max(start + 0.05, cue.end + from) });
    });
    if (updates.length > 0) this.solved = mergeRanges([...this.solved, { from: lowest, to: to - RIGHT_GUARD }]);
    return { method, updates, shift: this.shift, anchored, covered };
  }
}
