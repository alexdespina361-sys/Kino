import { describe, expect, it } from "vitest";
import { pairCaptions, timeFromEnglish } from "./bridge";
import type { Cue } from "./cues";
import { makeFilm, random, type Film } from "./synth";

/** A release of the film's captions in another language: each line moved by `shift` plus `drift` seconds per second and a little jitter, some lines missing, some extra. */
function release(film: Film, seed: number, options: { shift: number; drift?: number; jitter?: number; dropEvery?: number; extra?: number }): { cues: Cue[]; from: number[] } {
  const rand = random(seed);
  const cues: Cue[] = [];
  const from: number[] = [];
  film.truth.forEach((cue, k) => {
    if (options.dropEvery && k % options.dropEvery === 0) return;
    const move = options.shift + (options.drift ?? 0) * cue.start + (rand() - 0.5) * 2 * (options.jitter ?? 0.15);
    cues.push({ start: cue.start + move, end: cue.end + move, text: `línea ${k}` });
    from.push(k);
    if (options.extra && rand() < options.extra) {
      cues.push({ start: cue.end + move + 0.2, end: cue.end + move + 1.2, text: "sign" });
      from.push(-1);
    }
  });
  return { cues, from };
}

const film = makeFilm(5, 600);
/** The English release as downloaded (3.3 s late) and where the aligner put it (right). */
const english = { original: film.truth.map((cue) => ({ ...cue, start: cue.start + 3.3, end: cue.end + 3.3 })), placed: film.truth };

describe("pairing the captions of two releases", () => {
  it("pairs a release that is 1.7 s from the English one, with jitter", () => {
    const foreign = release(film, 1, { shift: 4.9 });
    const pairing = pairCaptions(foreign.cues.map((c) => c.start), english.original.map((c) => c.start));
    expect(pairing?.share).toBeGreaterThan(0.9);
  });

  it("pairs through missing and extra lines, and a slow drift", () => {
    const foreign = release(film, 2, { shift: 4.0, drift: 0.01, dropEvery: 7, extra: 0.1 });
    const pairing = pairCaptions(foreign.cues.map((c) => c.start), english.original.map((c) => c.start));
    expect(pairing?.share).toBeGreaterThan(0.8);
  });

  it("finds nothing between the captions of two different films", () => {
    const other = makeFilm(99, 600);
    const pairing = pairCaptions(other.truth.map((c) => c.start), english.original.map((c) => c.start));
    expect(pairing).toBeUndefined();
  });

  it("says nothing about a handful of lines", () => {
    expect(pairCaptions([1, 2, 3], [1, 2, 3])).toBeUndefined();
  });
});

describe("timing a release from the English one that was aligned", () => {
  const error = (foreign: { cues: Cue[]; from: number[] }, result: Cue[]) => {
    const errors = result.map((cue, i) => (foreign.from[i] === -1 ? undefined : Math.abs(cue.start - (film.truth[foreign.from[i] as number] as Cue).start)));
    return errors.filter((e): e is number => e !== undefined);
  };

  it("puts each line where the English one is said", () => {
    const foreign = release(film, 3, { shift: 4.9, dropEvery: 9 });
    const timed = timeFromEnglish(foreign.cues, english);
    expect(timed).toBeDefined();
    const errors = error(foreign, (timed as { cues: Cue[] }).cues);
    expect(errors.filter((e) => e <= 0.05).length / errors.length).toBeGreaterThan(0.95);
  });

  it("moves the lines without a pair the way their neighbours moved, and keeps the lines' lengths", () => {
    const foreign = release(film, 4, { shift: 4.9, extra: 0.15 });
    const timed = (timeFromEnglish(foreign.cues, english) as { cues: Cue[] }).cues;
    foreign.cues.forEach((cue, i) => {
      expect((timed[i] as Cue).end - (timed[i] as Cue).start).toBeCloseTo(cue.end - cue.start, 6);
    });
    const errors = error(foreign, timed);
    expect(errors.filter((e) => e <= 0.5).length / errors.length).toBeGreaterThan(0.97);
  });

  it("follows a release at another frame rate (4.2 % drift)", () => {
    const foreign = release(film, 5, { shift: 2.0, drift: 0.042 });
    const timed = (timeFromEnglish(foreign.cues, english) as { cues: Cue[] }).cues;
    const errors = error(foreign, timed);
    expect(errors.filter((e) => e <= 0.5).length / errors.length).toBeGreaterThan(0.9);
  });

  it("uses the English lines' latest places as the aligner moves them", () => {
    const foreign = release(film, 6, { shift: 4.9 });
    const later = { original: english.original, placed: film.truth.map((cue) => ({ ...cue, start: cue.start + 1, end: cue.end + 1 })) };
    const timed = (timeFromEnglish(foreign.cues, later) as { cues: Cue[] }).cues;
    const errors = timed.map((cue, i) => Math.abs(cue.start - ((film.truth[foreign.from[i] as number] as Cue).start + 1)));
    expect(errors.filter((e) => e <= 0.05).length / errors.length).toBeGreaterThan(0.95);
  });
});
