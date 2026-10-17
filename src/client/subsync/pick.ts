import type { Word } from "./signals";
import { AsrAnchor } from "./vendor/subtitle-sync.js";
import { isMusic, plainText, type Cue } from "./cues";

/** How far from the heard stretch a track's captions are looked for, so that a track that is some seconds or a minute off still counts. */
const SEARCH_MARGIN = 90;

/** What the recogniser has heard so far: the words, and how many seconds of sound it listened to for them. */
export interface Evidence {
  words: readonly Word[];
  seconds: number;
}

/**
 * How much of what was said is in this track: the share of the heard words that are found, in order, in captions that match them
 * (0 to 1). The captions' own times do not matter, only their words, so a track that is badly timed scores as well as a right one,
 * and the track of another film scores nothing. Lines of song are left out (an English theme song sits in the subtitles of every
 * language). Measured on five releases of three stretches of one show, at two minutes: the right track 0.37 to 0.71, another film's
 * 0.00 to 0.01, the same show's other parts 0.00 to 0.02, the same episode in another language 0.00.
 */
export function wordShare(cues: readonly Cue[], evidence: Evidence): number {
  const words = evidence.words;
  if (words.length === 0 || cues.length === 0) return 0;
  const from = (words[0] as Word).start - SEARCH_MARGIN;
  const to = (words[words.length - 1] as Word).start + SEARCH_MARGIN;
  const near = cues.filter((cue) => cue.start >= from && cue.start <= to && !isMusic(cue)).map((cue) => ({ start: cue.start, end: cue.end, text: plainText(cue.text) }));
  if (near.length === 0) return 0;
  const anchors = AsrAnchor.anchors(near, words, AsrAnchor.combinedNext.anchors);
  let matched = 0;
  for (const anchor of anchors) if (anchor.accepted) matched += anchor.matched;
  return Math.min(1, matched / words.length);
}

/** Enough was heard to say anything about the track (the first minutes of a film are often song, which counts for nothing here). */
export const MIN_WORDS = 200;
export const MIN_SECONDS = 120;
/** From this share the track is the right one; under the other, most of what is said is not in it. In between: not sure. */
export const RIGHT_SHARE = 0.25;
export const WRONG_SHARE = 0.08;
/** Another track replaces the shown one only if it is clearly right and clearly better. */
export const SWITCH_GAIN = 0.2;
/** The test is repeated when this many times as many words have been heard (more evidence settles "not sure", and checks a "right"), at most this many times. */
export const RETEST_GROWTH = 2.5;
export const MAX_TESTS = 4;
/** A test looks at the words of this many seconds at most (the matching grows with words times caption words). */
export const EVIDENCE_SECONDS = 300;

export type Verdict = "waiting" | "right" | "wrong" | "unsure";

/** What a share says, given how many words and seconds of speech it rests on. */
export function verdict(share: number, words: number, seconds: number): Verdict {
  if (words < MIN_WORDS || seconds < MIN_SECONDS) return "waiting";
  if (share >= RIGHT_SHARE) return "right";
  if (share < WRONG_SHARE) return "wrong";
  return "unsure";
}

export const judge = (share: number, evidence: Evidence): Verdict => verdict(share, evidence.words.length, evidence.seconds);

/** The track to switch to, if any: right in itself and clearly better than the shown one. */
export function bestAlternative(current: number, alternatives: ReadonlyArray<{ id: number; share: number }>): number | undefined {
  let best: { id: number; share: number } | undefined;
  for (const candidate of alternatives) {
    if (candidate.share < RIGHT_SHARE || candidate.share < current + SWITCH_GAIN) continue;
    if (!best || candidate.share > best.share) best = candidate;
  }
  return best?.id;
}
