// A made-up film for tests: captions with invented words, the sound they would make, and what a recogniser would hear.
import { SAMPLE_RATE, type Word } from "./signals";
import type { Cue } from "./cues";

/** A small deterministic random generator (mulberry32). */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const syllables = ["ba", "ko", "ri", "tu", "me", "sa", "no", "li", "da", "fe", "gu", "ha", "ji", "po", "re", "vi", "wo", "zu", "che", "sho"];

function invent(rand: () => number): string {
  const count = 1 + Math.floor(rand() * 3);
  let word = "";
  for (let i = 0; i < count; i++) word += syllables[Math.floor(rand() * syllables.length)];
  return word + syllables[Math.floor(rand() * syllables.length)];
}

export interface Film {
  /** What was really said, when. */
  truth: Cue[];
  /** The words a recogniser would hear, in the video's time. */
  words: Word[];
  seconds: number;
}

export function makeFilm(seed: number, seconds: number): Film {
  const rand = random(seed);
  const truth: Cue[] = [];
  const words: Word[] = [];
  let at = 3 + rand() * 2;
  while (at < seconds - 6) {
    const count = 4 + Math.floor(rand() * 5);
    const spoken = count * 0.33;
    const text = Array.from({ length: count }, () => invent(rand)).join(" ");
    const start = at - 0.08;
    const end = at + spoken + 0.15;
    truth.push({ start, end, text });
    text.split(" ").forEach((word, i) => words.push({ word, start: at + i * 0.33, end: at + i * 0.33 + 0.28, probability: 0.9 }));
    at += spoken + 0.9 + rand() * 2.5;
  }
  return { truth, words, seconds };
}

/** The sound: loud where the film says something (from the first word to the last), quiet elsewhere. */
export function makeAudio(film: Film, from: number, to: number): Float32Array {
  const out = new Float32Array(Math.round((to - from) * SAMPLE_RATE));
  const rand = random(7 + Math.round(from));
  for (let i = 0; i < out.length; i++) out[i] = (rand() - 0.5) * 0.02;
  for (const cue of film.truth) {
    const a = Math.max(from, cue.start + 0.08);
    const z = Math.min(to, cue.end - 0.15);
    for (let t = a; t < z; t += 1 / SAMPLE_RATE) {
      const k = Math.round((t - from) * SAMPLE_RATE);
      if (k >= 0 && k < out.length) out[k] = (rand() - 0.5) * 0.8;
    }
  }
  return out;
}

/** A voice detector for `makeAudio`: loud is speech. */
export class LoudnessVad {
  step(audio: Float32Array, from: number): number {
    let sum = 0;
    const end = Math.min(audio.length, from + 512);
    for (let i = from; i < end; i++) sum += (audio[i] as number) * (audio[i] as number);
    return Math.sqrt(sum / Math.max(1, end - from)) > 0.1 ? 0.97 : 0.02;
  }
  reset(): void {}
  save(): Float32Array {
    return new Float32Array(0);
  }
  restore(): void {}
}

/** The track as downloaded: the real times moved by `offset(t)`. */
export function misTimed(film: Film, offset: (t: number) => number): Cue[] {
  return film.truth.map((cue) => ({ start: cue.start - offset(cue.start), end: cue.end - offset(cue.start), text: cue.text }));
}

/**
 * The track of a dub: the lines of the film at the times `misTimed` gives, but the words are another translation's - none that the film's
 * speech has (each word turned around: the film's words all begin with a consonant, so none of them reads the same backwards).
 */
export function dubbed(film: Film, offset: (t: number) => number): Cue[] {
  return misTimed(film, offset).map((cue) => ({
    ...cue,
    text: cue.text
      .split(" ")
      .map((word) => [...word].reverse().join(""))
      .join(" "),
  }));
}
