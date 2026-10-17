import { heardRate, MIN_HEARD_RATE } from "./pick";
import { mergeRanges, type Range, type Signals, type Word } from "./signals";
import { AsrAnchor, Timing2, type Anchor } from "./vendor/subtitle-sync.js";
import { plainText, type Cue } from "./cues";

/**
 * How much sound one solve looks at, ending at the newest audio: a minute when the recogniser has listened to it (anchors keep the
 * aligner on track, and a short window is cheap), two and a half minutes for the voice detector alone (it needs many lines to tell a
 * real shift from a coincidence). Measured on the lab's clips, a minute is as good as two and a half with words, and worse without.
 */
export const WINDOW_WITH_WORDS = 60;
export const WINDOW_VOICE_ONLY = 150;
/** The first seconds of a window are left to the solve before it, which saw them with more sound around. */
const LEFT_GUARD = 10;
/** The last seconds are left to the next solve: the recogniser's last words and the voice detector's last frames are cut short there. */
const RIGHT_GUARD = 2;
/** Fewest heard words worth anchoring on. */
const MIN_WORDS = 12;
/** Fewest accepted captions that tell how far off a track is. */
const MIN_PROBE = 3;
/** How far from where the track is expected to be a caption can be found when the track's offset is not known yet (file seconds). */
const PROBE_RANGE = 90;
/** Below this share of the captions the recogniser listened to being matched, the words say nothing about this track: the voice detector alone is used, or, where speech is heard at a steady rate (`MIN_HEARD_RATE`), the dub timing. */
const MIN_SHARE = 0.3;
/** If the moves of the captions in a window differ by more than this between the 10th and 90th percentile, the window is not trusted. */
const MAX_SPREAD = 20;

/** The kit's own settings, as its `align()` uses them. */
const C = AsrAnchor.combinedNext;

/** `dub`: speech is heard but these are not its words (the English dub of a film whose subtitles translate the original): the file's timing, put on where people speak. */
export type Method = "whistle+silero" | "dub" | "silero" | "none";

export interface Update {
  index: number;
  start: number;
  end: number;
}

export interface Outcome {
  method: Method;
  /** New times (video time) for captions of this window. */
  updates: Update[];
  /** Video time minus the file's time, as far as it is known. */
  shift: number | null;
  /** Captions matched to heard words, of the captions in the stretches the recogniser listened to. */
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

/** Where the caption's first word was heard, for the ones the recogniser matched (a little earlier than the first matched word when the caption's own first words were missed). */
const heardStart = (anchor: Anchor): number | null => (anchor.accepted && anchor.start !== null ? anchor.start - (anchor.skipSyl ? Math.min(1.5, anchor.skipSyl / 5.5) : 0) : null);

/**
 * Times the captions of one subtitle file to the sound, a window at a time. Each `solve` takes the newest 150 s of sound the voice
 * detector (and, for English, the recogniser) has covered, picks the captions that belong there, and returns where they are said.
 * The aligner is the lab's (vendor/subtitle-sync.js); this decides which captions and sound go into it and what to trust coming out.
 */
export class TrackSolver {
  private readonly input: Cue[];
  private readonly starts: number[];
  /** Video time minus file time, learned from the words heard. */
  private shift: number | null = null;
  /** Heard words at the last probe that found nothing: do not probe again until there are many more. */
  private failedAt = 0;
  private solved: Range[] = [];

  /** `useWords`: the words of this track can be compared with what the recogniser hears (English subtitles over English speech). */
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

  /** The sound it learned from is gone: start over. */
  forget(): void {
    this.shift = null;
    this.failedAt = 0;
    this.solved = [];
  }

  /** Indices of the captions that start (in the file's time) from `from` to `to`. */
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

  /** How far this track is from the sound, from the words heard: the median over the captions found among them. Null when too few are. */
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

  /**
   * Places the captions that lie in the sound before `end`, a window of it (see `WINDOW_WITH_WORDS`) ending there or where the sound
   * does. The caller picks `end`: the end of the newest stretch of speech the recogniser heard, so that what is solved is what the
   * viewer will read next.
   */
  solve(signals: Signals, end: number): Outcome {
    const none: Outcome = { method: "none", updates: [], shift: this.shift, anchored: 0, covered: 0 };
    const stretch = signals.stretchAt(end);
    if (!stretch || this.input.length === 0) return none;
    const to = Math.min(end, stretch.to);
    const narrow = this.useWords && signals.wordsIn(to - WINDOW_WITH_WORDS, to).words.length >= MIN_WORDS;
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
        // (Speech is heard, and it is not these words: a dub, or another translation. The voice detector alone follows the wrong speech there, some
        // seconds late; the kit's answer, since its update 2, is the file's own timing - it was made for the same picture - put on the phrases heard.)
        out = AsrAnchor.dub(cues, relative, silero).cues;
        method = "dub";
      }
    }

    const moves = out.map((cue, k) => cue.start - (cues[k] as Cue).start);
    if (moves.length >= 5 && percentile(moves, 0.9) - percentile(moves, 0.1) > MAX_SPREAD) return { ...none, shift: this.shift };
    if (moves.length >= MIN_PROBE) this.shift = shift + median(moves);

    // Which captions to take from this solve: not the first seconds when an earlier solve already placed them with more sound around.
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
