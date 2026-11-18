import { EVIDENCE_SECONDS, heardRate, wordShare, type Evidence } from "./pick";
import type { Silero } from "./silero";
import { Signals, type Word } from "./signals";
import { TrackSolver, type Outcome } from "./solve";
import type { Cue } from "./cues";

export type Vad = Pick<Silero, "step" | "reset" | "save" | "restore">;

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

  setTrack(key: string, cues: readonly Cue[], useWords: boolean): void {
    this.tracks.set(key, new TrackSolver(cues, useWords));
  }

  dropTrack(key: string): void {
    this.tracks.delete(key);
  }

  solve(key: string, end: number): Outcome | undefined {
    return this.tracks.get(key)?.solve(this.signals, end);
  }

  evidence(latest = false): Evidence {
    const all = this.signals.wordsIn(-Infinity, Infinity);
    if (!latest || all.words.length === 0) return { words: all.words.filter((w) => w.start < all.words[0]!.start + EVIDENCE_SECONDS), seconds: Math.min(all.heardSeconds, EVIDENCE_SECONDS) };
    const end = all.words[all.words.length - 1]!.start;
    const heard = this.signals.wordsIn(end - EVIDENCE_SECONDS, end + 1);
    return { words: heard.words, seconds: heard.heardSeconds };
  }

  score(cues: readonly Cue[], latest = false): { share: number; words: number; seconds: number; rate: number } {
    const evidence = this.evidence(latest);
    return { share: wordShare(cues, evidence), words: evidence.words.length, seconds: evidence.seconds, rate: heardRate(evidence.words, evidence.seconds) };
  }

  reset(): void {
    this.signals.clear();
    this.tracks.forEach((track) => track.forget());
  }
}
