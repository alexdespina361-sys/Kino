import type { Word } from "./signals";
import { AsrAnchor } from "./vendor/subtitle-sync.js";
import { isMusic, plainText, type Cue } from "./cues";

const SEARCH_MARGIN = 90;

export interface Evidence {
  words: readonly Word[];
  seconds: number;
}

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

const SURE = 0.5;
const MIN_RATE_SECONDS = 10;
export const MIN_HEARD_RATE = 0.25;

export function heardRate(words: readonly Word[], seconds: number): number {
  if (seconds < MIN_RATE_SECONDS) return 0;
  let sure = 0;
  for (const word of words) if ((word.probability ?? 1) >= SURE) sure++;
  return sure / seconds;
}

export const MIN_WORDS = 200;
export const MIN_SECONDS = 120;
export const RIGHT_SHARE = 0.25;
export const WRONG_SHARE = 0.08;
export const SWITCH_GAIN = 0.2;
export const RETEST_GROWTH = 2.5;
export const MAX_TESTS = 4;
export const EVIDENCE_SECONDS = 300;

export type Verdict = "waiting" | "right" | "wrong" | "unsure";

export function verdict(share: number, words: number, seconds: number): Verdict {
  if (words < MIN_WORDS || seconds < MIN_SECONDS) return "waiting";
  if (share >= RIGHT_SHARE) return "right";
  if (share < WRONG_SHARE) return "wrong";
  return "unsure";
}

export const judge = (share: number, evidence: Evidence): Verdict => verdict(share, evidence.words.length, evidence.seconds);

export function bestAlternative(current: number, alternatives: ReadonlyArray<{ id: number; share: number }>): number | undefined {
  let best: { id: number; share: number } | undefined;
  for (const candidate of alternatives) {
    if (candidate.share < RIGHT_SHARE || candidate.share < current + SWITCH_GAIN) continue;
    if (!best || candidate.share > best.share) best = candidate;
  }
  return best?.id;
}
