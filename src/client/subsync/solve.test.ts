import { describe, expect, it } from "vitest";
import { SyncCore } from "./core";
import { SAMPLE_RATE } from "./signals";
import { LoudnessVad, makeAudio, makeFilm, misTimed, type Film } from "./synth";
import type { Cue } from "./cues";

const PIECE = 6; // seconds of sound that arrive together
const WINDOW = 15; // seconds the recogniser is given

interface Run {
  /** Fraction of captions within `tolerance` of when they were really said. */
  within(tolerance: number): number;
  result: Cue[];
  core: SyncCore;
}

/** Play the film through the aligner the way the player would feed it: sound in pieces, the recogniser a window at a time, a solve after each window. */
function play(film: Film, track: Cue[], options: { words?: (window: number) => boolean; useWords?: boolean; until?: number } = {}): Run {
  const core = new SyncCore(new LoudnessVad());
  core.setTrack("t", track, options.useWords ?? true);
  const result = track.map((cue) => ({ ...cue }));
  const until = options.until ?? film.seconds;
  let heardTo = 0;
  for (let t = 0; t + PIECE <= until; t += PIECE) {
    core.addAudio(t, makeAudio(film, t, t + PIECE));
    const covered = t + PIECE;
    while (heardTo + WINDOW <= covered) {
      if (!options.words || options.words(heardTo / WINDOW)) {
        const words = film.words.filter((w) => w.start >= heardTo && w.start < heardTo + WINDOW);
        core.addWords(words, heardTo, heardTo + WINDOW);
      }
      heardTo += WINDOW;
      const outcome = core.solve("t", covered);
      for (const update of outcome?.updates ?? []) {
        const cue = result[update.index] as Cue;
        cue.start = update.start;
        cue.end = update.end;
      }
    }
  }
  const finished = film.truth.map((cue, i) => ({ cue, got: result[i] as Cue })).filter(({ cue }) => cue.start < until - 6);
  return {
    core,
    result,
    within: (tolerance) => finished.filter(({ cue, got }) => Math.abs(got.start - cue.start) <= tolerance).length / Math.max(1, finished.length),
  };
}

const film = makeFilm(11, 240);

describe("the sound the test film makes", () => {
  it("has speech where the captions are and silence between", () => {
    const pcm = makeAudio(film, 0, 20);
    expect(pcm.length).toBe(20 * SAMPLE_RATE);
    const cue = film.truth[0] as Cue;
    const loud = Math.abs(pcm[Math.round((cue.start + 0.5) * SAMPLE_RATE)] as number);
    expect(loud + Math.abs(pcm[Math.round((cue.start + 0.6) * SAMPLE_RATE)] as number)).toBeGreaterThan(0);
  });
});

// (Each film is a few seconds of work; with other test files running beside it the default 5 s is too close.)
describe("TrackSolver and SyncCore, played through like a film", { timeout: 60_000 }, () => {
  it("puts captions that were a constant 3.2 s late where they are said (words and voice)", () => {
    const run = play(film, misTimed(film, () => -3.2));
    expect(run.within(0.3)).toBeGreaterThan(0.95);
    expect(run.core.evidence().words.length).toBeGreaterThan(100);
  });

  it("follows a track that drifts from 1 s to 7 s early", () => {
    const run = play(film, misTimed(film, (t) => 1 + t * 0.025));
    expect(run.within(0.3)).toBeGreaterThan(0.9);
  });

  it("follows a track with a jump in it (a different cut after 2 minutes)", () => {
    const run = play(film, misTimed(film, (t) => (t < 120 ? -3 : 9)));
    expect(run.within(0.5)).toBeGreaterThan(0.85);
  });

  it("copes with the recogniser listening to only every third window", () => {
    const run = play(film, misTimed(film, () => 4.4), { words: (window) => window % 3 === 0 });
    expect(run.within(0.5)).toBeGreaterThan(0.85);
  });

  it("does better than the downloaded times with the voice detector alone (other languages)", () => {
    const track = misTimed(film, () => 2.6);
    const before = track.filter((cue, i) => Math.abs(cue.start - (film.truth[i] as Cue).start) <= 0.5).length / track.length;
    const run = play(film, track, { useWords: false });
    expect(before).toBeLessThan(0.05);
    expect(run.within(0.5)).toBeGreaterThan(0.7);
  });

  it("finds a track that is a minute off when it has the words", () => {
    const run = play(film, misTimed(film, () => 60));
    expect(run.within(0.5)).toBeGreaterThan(0.9);
  });

  it("leaves a track that is already right alone", () => {
    const run = play(film, misTimed(film, () => 0));
    expect(run.within(0.2)).toBeGreaterThan(0.95);
  });
});
