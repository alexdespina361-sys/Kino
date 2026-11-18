import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LoudnessVad, makeAudio, makeFilm, misTimed } from "../../../client/subsync/synth";
import { fixSubtitle } from "./fix";
import { decodeSubtitle, formatOf, readSubtitle, toSrt } from "./formats";
import { checkLine, type Polisher } from "./polish";
import { runSeconv } from "./seconv";
import { timeToSound } from "./sync";

const run = promisify(execFile);

describe("reading a subtitle file", () => {
  it("reads SRT as the screens do, with short hours, a BOM and Windows line ends", () => {
    const srt = "﻿1\r\n0:00:01,5 --> 0:00:02,000\r\n<i>Hello</i>\r\nthere\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,250\r\nAgain.\r\n";
    expect(formatOf(srt, "a.srt")).toBe("srt");
    expect(readSubtitle(srt)).toEqual([
      { start: 1.5, end: 2, text: "<i>Hello</i>\nthere" },
      { start: 3, end: 4.25, text: "Again." },
    ]);
  });

  it("reads the dialogue of ASS: italics kept, other tags, drawings and comments left out, commas in the text kept", () => {
    const ass = [
      "[Script Info]",
      "Title: made up",
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:05.10,0:00:07.00,Default,,0,0,0,,{\\an8}{\\i1}Wait,{\\i0} not yet\\Nplease",
      "Comment: 0,0:00:06.00,0:00:07.00,Default,,0,0,0,,a note",
      "Dialogue: 0,0:00:08.00,0:00:09.00,Sign,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}",
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,First",
    ].join("\n");
    expect(formatOf(ass)).toBe("ass");
    expect(readSubtitle(ass)).toEqual([
      { start: 1, end: 2, text: "First" },
      { start: 5.1, end: 7, text: "<i>Wait,</i> not yet\nplease" },
    ]);
  });

  it("decodes a Romanian file in its old code page, and writes SRT back", () => {
    const bytes = Uint8Array.from([0xba, 0x69, 0x20, 0xe3, 0x73, 0x74, 0x61]);
    expect(decodeSubtitle(bytes, "ro")).toBe("şi ăsta");
    expect(toSrt([{ start: 3661.5, end: 3662, text: "One\n\nTwo" }])).toBe("1\r\n01:01:01,500 --> 01:01:02,000\r\nOne\r\nTwo\r\n");
  });
});

describe("fixing a file", () => {
  const cues = [
    { start: 10, end: 12, text: "Subtitles by A Made Up Team" },
    { start: 200, end: 202, text: "-Where are you ?" },
    { start: 205, end: 205, text: "Here." },
    { start: 5400, end: 5402, text: "The end." },
  ];

  it("tidies, keeps a line that ends before it starts on screen, and writes down every change", async () => {
    const { cues: fixed, report } = await fixSubtitle(cues, "made up", { lang: "en" });
    expect(fixed.map((cue) => cue.text)).toEqual(["- Where are you?", "Here.", "The end."]);
    expect(fixed[1]!.end).toBeGreaterThan(205.5);
    expect(report.dropped).toEqual([{ from: 0, start: 10, text: "Subtitles by A Made Up Team" }]);
    expect(report.changes.map((change) => [change.from, change.by])).toEqual([
      [1, ["tidy"]],
      [2, ["valid"]],
    ]);
    expect(report.lines).toEqual({ in: 4, out: 3 });
    expect(report.source).toMatch(/^[0-9a-f]{64}$/);
  });

  it("takes a model's wording only where nothing that matters was lost", async () => {
    const lines = [
      { start: 100, end: 102, text: "Could it be that you are planning to not return here anymore?" },
      { start: 103, end: 105, text: "I have 3 brothers, Tom." },
      { start: 106, end: 108, text: "It is good." },
    ];
    const model: Polisher = { name: "fake", polish: async () => ["Are you saying you're never coming back?", "I have brothers.", "It's good."] };
    const { cues: fixed, report } = await fixSubtitle(lines, "x", { lang: "en", polish: { polisher: model, strength: "adaptive" } });
    expect(fixed.map((cue) => cue.text)).toEqual(["Are you saying you're never coming back?", "I have 3 brothers, Tom.", "It's good."]);
    expect(report.refused).toEqual([{ line: 1, text: "I have brothers.", why: "numbers changed" }]);
    const short: Polisher = { name: "short", polish: async () => ["one"] };
    expect((await fixSubtitle(lines, "x", { lang: "en", polish: { polisher: short, strength: "natural" } })).report.refused[0]!.why).toBe("not one for one");
  });

  it("checks a model's line for lost negation, names, numbers and dashes", () => {
    expect(checkLine("I did not go.", "I went.", "en", "natural")).toBe("negation changed");
    expect(checkLine("Nu am plecat.", "Am plecat.", "ro", "natural")).toBe("negation changed");
    expect(checkLine("Tell it to Maria now.", "Tell her now.", "en", "natural")).toBe("name Maria lost");
    expect(checkLine("- Go.", "Go.", "en", "natural")).toBe("speaker dash changed");
    expect(checkLine("We leave at nine.", "", "en", "natural")).toBe("empty");
    expect(checkLine("this are wrong", "this is wrong", "en", "conservative")).toBeUndefined();
    expect(checkLine("I want it, you know, really.", "Gimme.", "en", "conservative")).toBe("too much rewritten for conservative");
  });

  it("says Subtitle Edit's step was not done when its program is not there, and changes nothing for it", async () => {
    const { report } = await fixSubtitle(cues, "x", { lang: "en", seconv: path.join(tmpdir(), "no-such-seconv.exe") });
    expect(report.steps.find((step) => step.step === "subtitle-edit")).toMatchObject({ done: false });
    expect(report.changes.every((change) => !change.by.includes("subtitle-edit"))).toBe(true);
  });
});

describe("timing a file to the film's sound with the screens' aligner", () => {
  it("puts lines that are three seconds late where they are said", { timeout: 120_000 }, async () => {
    const film = makeFilm(11, 300);
    const late = misTimed(film, () => -3);
    const pieces = Array.from({ length: 30 }, (_, i) => makeAudio(film, i * 10, i * 10 + 10));
    const timed = await timeToSound(late, pieces, new LoudnessVad());
    const near = timed.cues.filter((cue, i) => film.truth[i]!.start > 20 && Math.abs(cue.start - film.truth[i]!.start) < 0.5).length;
    expect(near / film.truth.filter((cue) => cue.start > 20).length).toBeGreaterThan(0.9);
    expect(timed.shift).toBeCloseTo(-3, 0);
    expect(timed.methods.silero).toBeGreaterThan(0);
  });
});

describe.runIf(Boolean(process.env.SECONV))("Subtitle Edit's fixes (the real seconv)", () => {
  it("mends spaces, commas, a lone i and a long line, and keeps every line", async () => {
    const lines = [
      { start: 1, end: 3, text: "i think so ,really.Yes" },
      { start: 4, end: 9, text: "This is a very long line that should be broken somewhere in the middle of it ok" },
    ];
    const done = await runSeconv(lines, { lang: "en", timing: false });
    if ("failed" in done) throw new Error(done.failed);
    expect(done.cues.map((cue) => cue.text)).toEqual(["I think so, really. Yes", "This is a very long line that should be\nbroken somewhere in the middle of it ok"]);
  });
});

describe("the command", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "kino-subfix-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps the file, writes a new version and its report, and does not do the same file the same way twice", { timeout: 60_000 }, async () => {
    const file = path.join(dir, "film.srt");
    await writeFile(file, "1\r\n00:00:10,000 --> 00:00:12,000\r\nDownloaded from www.example-subs.net\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,000\r\n-Hi .\r\n\r\n");
    const fix = () => run(process.execPath, [path.resolve("scripts/subfix.mjs"), file, "--lang", "en"], { timeout: 60_000 });
    expect((await fix()).stdout).toContain("film.kino-v1.srt");
    expect((await fix()).stdout).toContain("Already done the same way");
    expect((await readdir(dir)).sort()).toEqual(["film.kino-v1.report.json", "film.kino-v1.srt", "film.original.srt", "film.srt"]);
    expect(await readFile(path.join(dir, "film.kino-v1.srt"), "utf8")).toBe("1\r\n00:01:00,000 --> 00:01:02,000\r\n- Hi.\r\n");
    const report = JSON.parse(await readFile(path.join(dir, "film.kino-v1.report.json"), "utf8")) as { dropped: unknown[]; asked: unknown };
    expect(report.dropped).toHaveLength(1);
    expect(report.asked).toEqual({ audio: false, seconv: false, polish: false });
  });
});
