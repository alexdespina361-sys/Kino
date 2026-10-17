import { beforeEach, describe, expect, it } from "vitest";
import { alignerStats, describeAligner, resetAlignerStats } from "./stats";

beforeEach(resetAlignerStats);

describe("the aligner's numbers for the debug panel", () => {
  it("say nothing until a film has started the aligner", () => {
    expect(describeAligner(alignerStats)).toBeNull();
  });

  it("say what it has done in one line", () => {
    Object.assign(alignerStats, {
      started: true,
      status: "synced",
      pieces: 60,
      decodedSeconds: 354.4,
      decodeMs: 1100,
      vadSeconds: 354.4,
      vadMs: 9200,
      recogniser: "running",
      windows: 8,
      words: 412,
      heardSeconds: 120,
      speed: 4.12,
      solves: 14,
      placed: 131,
      lines: 153,
      tests: 1,
      verdict: "right",
      share: 0.52,
    });
    const line = describeAligner(alignerStats)!;
    expect(line).toContain("aligner: synced");
    expect(line).toContain("354s decoded in 1.1s");
    expect(line).toContain("recogniser running: 412 words, 8 windows (120s) at 4.1x");
    expect(line).toContain("131/153 lines placed");
    expect(line).toContain("tests 1: right 0.52, switches 0");
    expect(line).not.toContain("English track");
  });

  it("say how the solves placed the lines, so that a dub can be told from the voice detector alone", () => {
    Object.assign(alignerStats, { started: true, status: "synced", solves: 9, methods: { "whistle+silero": 2, dub: 6, silero: 1 }, placed: 40, lines: 50, tests: 1, verdict: "dub", share: 0.05 });
    const line = describeAligner(alignerStats)!;
    expect(line).toContain("solves 9 (words 2, dub 6, voice 1), 40/50 lines placed");
    expect(line).toContain("tests 1: dub 0.05, switches 0");
    resetAlignerStats();
    Object.assign(alignerStats, { started: true, solves: 3 });
    expect(describeAligner(alignerStats)).toContain("solves 3, 0/0 lines placed");
  });

  it("say why it gave up, and when a track is timed from the English one", () => {
    Object.assign(alignerStats, { started: true, status: "unavailable", gaveUp: "The sound of this film cannot be read here", bridged: true });
    const line = describeAligner(alignerStats)!;
    expect(line).toContain("unavailable (The sound of this film cannot be read here)");
    expect(line).toContain("(from the English track)");
  });

  it("say where the timing that other screens left stands, and how much this screen left", () => {
    Object.assign(alignerStats, { started: true, status: "synced", shared: "believed (all of it)", sent: 120 });
    expect(describeAligner(alignerStats)).toContain("shared timing: believed (all of it), left 120 lines");
    resetAlignerStats();
    Object.assign(alignerStats, { started: true });
    expect(describeAligner(alignerStats)).not.toContain("shared timing");
  });

  it("start again for the next film", () => {
    alignerStats.started = true;
    alignerStats.words = 99;
    resetAlignerStats();
    expect(alignerStats.started).toBe(false);
    expect(alignerStats.words).toBe(0);
  });
});
