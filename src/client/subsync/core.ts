import { EVIDENCE_SECONDS, heardRate, wordShare, type Evidence } from "./pick";
import type { Silero } from "./silero";
import { Signals, type Word } from "./signals";
import { TrackSolver, type Outcome } from "./solve";
import type { Cue } from "./cues";

/** The voice detector as the signals store needs it (the real one is `Silero`; tests use a simpler one). */
export type Vad = Pick<Silero, "step" | "reset" | "save" | "restore">;

/**
 * Everything the aligner knows and does, in one place, so it can run in a worker and be tested without one: the sound's signals, a
 * solver for each subtitle track being followed, and the test of how well a track's words fit what was heard.
 */
export class SyncCore {
  private readonly signals: Signals;
  private readonly tracks = new Map<string, TrackSolver>();

  constructor(vad: Vad) {
    this.signals = new Signals(vad);
  }

  addAudio(time: number, pcm: Float32Array): boolean {
    return this.signals.addAudio(time, pcm);
  }

  addWords(words: readonly Word[], from: number, to: number): void {
    this.signals.addWords(words, from, to);
  }

  /** Start following a subtitle track. `useWords`: its words can be compared with the recogniser's (English subtitles over English speech). */
  setTrack(key: string, cues: readonly Cue[], useWords: boolean): void {
    this.tracks.set(key, new TrackSolver(cues, useWords));
  }

  dropTrack(key: string): void {
    this.tracks.delete(key);
  }

  /** Place the captions of track `key` that lie in the sound before `end`. */
  solve(key: string, end: number): Outcome | undefined {
    return this.tracks.get(key)?.solve(this.signals, end);
  }

  /** What has been heard, the first minutes of it (the start of a film is where the words of a wrong track show up first) or the newest `EVIDENCE_SECONDS`. */
  evidence(latest = false): Evidence {
    const all = this.signals.wordsIn(-Infinity, Infinity);
    if (!latest || all.words.length === 0) return { words: all.words.filter((w) => w.start < all.words[0]!.start + EVIDENCE_SECONDS), seconds: Math.min(all.heardSeconds, EVIDENCE_SECONDS) };
    const end = all.words[all.words.length - 1]!.start;
    const heard = this.signals.wordsIn(end - EVIDENCE_SECONDS, end + 1);
    return { words: heard.words, seconds: heard.heardSeconds };
  }

  /** How well a track's words fit what was heard (the tracks the aligner is not following can be tried this way), and how much speech there was to fit them to. */
  score(cues: readonly Cue[], latest = false): { share: number; words: number; seconds: number; rate: number } {
    const evidence = this.evidence(latest);
    return { share: wordShare(cues, evidence), words: evidence.words.length, seconds: evidence.seconds, rate: heardRate(evidence.words, evidence.seconds) };
  }

  /** Forget the sound and what was heard (another audio track), keeping the subtitle tracks. */
  reset(): void {
    this.signals.clear();
    this.tracks.forEach((track) => track.forget());
  }
}
