// Types for the parts of the lab's aligner (subtitle-sync.js, the kit's update 2, unchanged) that this app uses.

/** Which timing the aligner gives; part of the key of anything saved from it. */
export const VERSION: string;

export interface AlignCue {
  start: number;
  end: number;
  text: string;
}

export interface Anchor {
  /** Words of the caption found among the heard words. */
  matched: number;
  /** matched / the caption's words. */
  coverage: number;
  accepted: boolean;
  /** Where the first matched word was heard, or null when the caption is not accepted. */
  start: number | null;
  firstIndex: number | null;
  /** Syllables of the caption's words before the first matched one. */
  skipSyl: number;
  prob: number;
  rescued: number | null;
  lastEnd: number | null;
}

export interface HeardWord {
  word: string;
  start: number;
  end: number;
  probability?: number | undefined;
}

export const Timing2: {
  /** Times for `cues` from a speech probability track (10 ms values from the start of the audio). Returns the cues as they were when it holds back. */
  align(cues: readonly AlignCue[], prob: Float32Array, config?: object, features?: object): { cues: AlignCue[]; status: string };
};

export const AsrAnchor: {
  /** Match each caption's words to the heard words (text only, so the captions' own times do not matter). */
  anchors(cues: readonly AlignCue[], words: readonly HeardWord[], options?: object): Anchor[];
  /** Final times: anchored captions on the voice onset near the heard word, the others between their neighbours. `base` is Timing2's answer. */
  place(cues: readonly AlignCue[], anchors: readonly Anchor[], prob: Float32Array, options?: object): AlignCue[];
  /**
   * Update 2, for subtitles whose words are not what is said while speech is heard (the English dub of a film whose subtitles translate the
   * original): the file's timing, moved by one offset (up to 10 s) onto the phrases that are heard, lines in their order and not on screen
   * together. The cues come back in the same order, each with a `how` note.
   */
  dub(cues: readonly AlignCue[], words: readonly HeardWord[], prob: Float32Array, options?: object): { cues: AlignCue[]; shift: number; hits: number; hitsAtZero: number };
  /** The settings of the kit's `align()` since update 1 (`combined` plus the in-word and short-caption onsets). */
  combinedNext: { anchors: object; place: object };
};
