import type { Cue } from "./cues";

/** How far apart (seconds) the starts of two releases of one film's captions can be, after their shift, and still be the same line. */
const TOLERANCE = 0.4;
/** Where the shift between two releases is looked for (seconds either way), in steps of `BIN`. */
const SPAN = 120;
const BIN = 0.1;
/** Fewest captions in each release for the comparison to say anything. */
const MIN_CUES = 10;
/** Under this share of the captions pairing up, the two are not the same film (or not the same cut). */
export const MIN_PAIRED = 0.6;
/** The captions the shift is looked for with, and how many of them must agree on it (of those). */
const CHUNK = 30;
const AGREE = 0.5;
/** This many captions in a row without a pair and the shift is looked for again (a different cut). */
const LOST = 6;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const k = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[k] as number) : ((sorted[k - 1] as number) + (sorted[k] as number)) / 2;
};

/** The index of the value in `sorted` nearest to `x`. */
function nearest(sorted: readonly number[], x: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((sorted[mid] as number) < x) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && (low === sorted.length || x - (sorted[low - 1] as number) < (sorted[low] as number) - x)) return low - 1;
  return low;
}

/** The slopes a shift can have besides none: 25 and 23.976 pictures a second (a film sped up for PAL) are 4.2 % apart, the other way round too. */
const SLOPES = [0, 0.042, -0.042];

/**
 * The shift (English start minus the caption's, at the first of captions `from` to `to`) and slope that most of those captions agree
 * on, looking `SPAN` seconds either way of `centre`; undefined when too few do.
 */
function acquire(foreign: readonly number[], english: readonly number[], from: number, to: number, centre: number): { shift: number; slope: number } | undefined {
  const bins = Math.ceil((2 * SPAN) / BIN) + 1;
  const reach = Math.round(TOLERANCE / BIN);
  const origin = foreign[from] as number;
  let best: { shift: number; slope: number; peak: number } | undefined;
  for (const slope of SLOPES) {
    const histogram = new Float64Array(bins);
    for (let i = from; i < to; i++) {
      const start = foreign[i] as number;
      const expected = start + centre + slope * (start - origin);
      for (let j = nearest(english, expected - SPAN); j < english.length && (english[j] as number) <= expected + SPAN; j++) {
        const difference = (english[j] as number) - expected;
        if (difference >= -SPAN) histogram[Math.floor((difference + SPAN) / BIN)]! += 1;
      }
    }
    for (let k = reach; k < bins - reach; k++) {
      let sum = 0;
      for (let q = -reach; q <= reach; q++) sum += histogram[k + q] as number;
      if (!best || sum > best.peak) best = { shift: centre + (k + 0.5) * BIN - SPAN, slope, peak: sum };
    }
  }
  return best && best.peak >= AGREE * (to - from) ? { shift: best.shift, slope: best.slope } : undefined;
}

/**
 * Which caption of an English release each caption of a release in another language is, by when they start. Two releases of one film
 * differ by a shift (seconds, sometimes a slow drift), not by their lines' order, so the captions are followed one after the other:
 * the shift is found from a few of them, each pair corrects it, and a run of captions without a pair (another cut) starts the search
 * again. `match[i]` is the English caption paired with caption `i`, or -1; `share` is how many were paired.
 */
export function pairCaptions(foreign: readonly number[], english: readonly number[]): { match: Int32Array; share: number } | undefined {
  if (foreign.length < MIN_CUES || english.length < MIN_CUES) return undefined;
  const match = new Int32Array(foreign.length).fill(-1);
  /** Where the English captions are relative to these: `shift` at `ref`, growing by `slope` a second. */
  let track: { shift: number; slope: number; ref: number } | undefined;
  let misses = 0;
  for (let i = 0; i < foreign.length; i++) {
    const start = foreign[i] as number;
    if (!track || misses >= LOST) {
      if (track || i % 5 === 0) {
        const found = acquire(foreign, english, i, Math.min(foreign.length, i + CHUNK), track ? track.shift + track.slope * (start - track.ref) : 0);
        if (found) {
          track = { ...found, ref: start };
          misses = 0;
        }
      }
      if (!track) continue;
    }
    const predicted = track.shift + track.slope * (start - track.ref);
    const j = nearest(english, start + predicted);
    if (Math.abs((english[j] as number) - (start + predicted)) <= TOLERANCE) {
      match[i] = j;
      track = { shift: predicted + 0.3 * ((english[j] as number) - start - predicted), slope: track.slope, ref: start };
      misses = 0;
    } else misses++;
  }
  const paired = match.reduce((n, j) => n + (j >= 0 ? 1 : 0), 0);
  const share = paired / foreign.length;
  return share >= MIN_PAIRED ? { match, share } : undefined;
}

/**
 * Times for the captions of a release in another language from the English release that was timed to the sound: a paired caption
 * starts where its English caption does (and keeps its own length), one without a pair moves as the paired ones around it do.
 * `english.placed` is where each English caption is now (its aligned time, or the best guess until it is aligned). Undefined when
 * the releases do not pair up. A pairing made before (`pairCaptions`) can be given, to not look for it again.
 */
export function timeFromEnglish(
  foreign: readonly Cue[],
  english: { original: readonly Cue[]; placed: readonly Cue[] },
  given?: { match: Int32Array; share: number },
): { cues: Cue[]; share: number } | undefined {
  const pairing =
    given ??
    pairCaptions(
      foreign.map((cue) => cue.start),
      english.original.map((cue) => cue.start),
    );
  if (!pairing) return undefined;
  const moves = Array.from(pairing.match, (j, i): number | undefined => (j >= 0 ? (english.placed[j] as Cue).start - (foreign[i] as Cue).start : undefined));
  const known = moves.flatMap((move, i) => (move === undefined ? [] : [i]));
  const cues = foreign.map((cue, i): Cue => {
    let move = moves[i];
    if (move === undefined) {
      // The three nearest paired captions (by position in the file).
      const at = nearest(known, i);
      const around = known.slice(Math.max(0, at - 2), at + 3).sort((a, b) => Math.abs(a - i) - Math.abs(b - i)).slice(0, 3);
      move = median(around.map((k) => moves[k] as number));
    }
    return { start: cue.start + move, end: cue.end + move, text: cue.text };
  });
  return { cues, share: pairing.share };
}
