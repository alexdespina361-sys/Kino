import { describe, expect, it } from "vitest";
import type { OfficialOffer, SubtitleTrack } from "../../shared";
import type { ResolveResult } from "../resolvers";
import { BETTER_BY, fromSubtitleSite, MemoryOfficialStore, officialId, Officials, timesFromOffer } from "./official";
import { parseVtt, toVtt } from "./vtt";

// (Made-up lines only: the repo is public.)
const EPISODE = "https://filmpire.sc/watch/60572?s=2&e=3";
const PLAY = "filmpire:tv:60572:2:3";
const RO = "/api/subtitles/ro/abc-s2e3.vtt";
const OS = `/api/proxy?url=${encodeURIComponent("https://subs5.strem.io/en/download/file/1")}&format=vtt`;
const CAPTION = `/api/proxy?url=${encodeURIComponent("https://cdn.example-video.net/captions/en.vtt")}&format=vtt`;

/** A file of `count` lines, one every ten seconds from the first minute, credits at its start. */
function file(count = 60): string {
  const cues = [{ start: 5, end: 7, text: "Subtitles by A Made Up Team" }];
  for (let i = 1; i < count; i++) cues.push({ start: 60 + i * 10, end: 62 + i * 10, text: i % 7 === 0 ? `-Line number ${i}.` : `Line number ${i}.` });
  return toVtt(cues);
}

/** What a screen found: every line `late` seconds after the file has it, by words where `words` says so; the lines in `skip` not placed. */
function offerOf(text: string, { track = OS, late = 2.5, words = () => true, skip = new Set<number>() }: { track?: string; late?: number; words?: (i: number) => boolean; skip?: Set<number> } = {}): OfficialOffer {
  const cues = parseVtt(text);
  return {
    v: 1,
    track,
    duration: 2700,
    lines: cues.map((cue, i) => {
      if (skip.has(i)) return null;
      const start = Math.round((cue.start + late) * 100);
      return [Math.round(cue.start * 100), start, Math.round((cue.end + late) * 100), words(i) ? 1 : 0];
    }),
  };
}

const track = (id: number, lang: string, url: string, label: string): SubtitleTrack => ({ id, lang, url, label });
function played(subtitles: SubtitleTrack[], alternates?: Array<{ subtitles?: SubtitleTrack[] }>): Extract<ResolveResult, { status: "success" }> {
  return {
    status: "success",
    resolver: "filmpire",
    media: {
      stream: { url: "https://video.example/master.m3u8", type: "hls" },
      subtitles,
      ...(alternates ? { alternates: alternates.map((each, i) => ({ stream: { url: `https://video.example/${i}.m3u8`, type: "hls" as const }, ...each })) } : {}),
    },
  };
}
const LISTED = [track(0, "en", CAPTION, "English"), track(1, "en", OS, "English · Some.Show.S02E03.WEB"), track(2, "ro", RO, "Română · subs.ro"), track(3, "fr", "/api/proxy?url=x", "Français")];

async function setUp(texts: Record<string, string> = { [OS]: file(), [RO]: file() }) {
  let now = 1_800_000_000_000;
  const store = new MemoryOfficialStore();
  const officials = await Officials.open({ store, now: () => now, max: 3 });
  const fetched: string[] = [];
  const fetchFile = async (link: string) => {
    fetched.push(link);
    return texts[link];
  };
  officials.heard(EPISODE, played(LISTED), { title: "Some Show", kind: "series" });
  return { officials, store, fetchFile, fetched, later: (ms: number) => (now += ms) };
}

describe("fromSubtitleSite: what may be made a Kino Official file", () => {
  it("is the Romanian sites' files the server keeps and OpenSubtitles' through the proxy, never a video's own captions", () => {
    expect(fromSubtitleSite(RO)).toBe(true);
    expect(fromSubtitleSite(OS)).toBe(true);
    expect(fromSubtitleSite(`/api/proxy?url=${encodeURIComponent("https://dl.opensubtitles.org/x")}&format=vtt`)).toBe(true);
    expect(fromSubtitleSite(CAPTION)).toBe(false);
    expect(fromSubtitleSite(`/api/proxy?url=${encodeURIComponent("http://subs5.strem.io/x")}`)).toBe(false);
    expect(fromSubtitleSite(`/api/proxy?url=${encodeURIComponent("https://strem.io.evil.example/x")}`)).toBe(false);
    expect(fromSubtitleSite("https://subs5.strem.io/x")).toBe(false);
  });
});

describe("an offer", () => {
  it("makes the title's file: the file's text tidied, the screen's times, and it is listed first of its language", async () => {
    const { officials, store, fetchFile } = await setUp();
    expect(await officials.offer(offerOf(file()), fetchFile)).toBe("taken");
    const id = officialId(PLAY, "en");
    const record = (await store.get(id))!;
    expect(record.meta).toMatchObject({ play: PLAY, lang: "en", title: "Some Show", season: 2, episode: 3, lines: 59, from: { track: OS }, duration: 2700, cleaned: { removed: 1 } });
    // (The credits line gone, each line 2.5 s later, the dash written with its space.)
    expect(record.lines[0]).toEqual([7250, 7450, "Line number 1."]);
    expect(record.lines[6]).toEqual([13250, 13450, "- Line number 7."]);
    expect(record.source).toContainEqual([6, "-Line number 7."]);

    const answer = officials.withOfficial(EPISODE, played(LISTED));
    if (answer.status !== "success") throw new Error("not a success");
    expect(answer.media.subtitles!.map((each) => [each.id, each.label])).toEqual([
      [0, "English · Kino Official"],
      [1, "English"],
      [2, "English · Some.Show.S02E03.WEB"],
      [3, "Română · subs.ro"],
      [4, "Français"],
    ]);
    const served = await officials.vtt(id, record.meta.rev);
    expect(served?.current).toBe(true);
    expect(answer.media.subtitles![0]!.url).toBe(`/api/subtitles/official/${id}-${record.meta.rev}.vtt`);
    expect(parseVtt(served!.vtt).slice(0, 1)).toEqual([{ start: 72.5, end: 74.5, text: "Line number 1." }]);
  });

  it("is turned away for a track that was not listed for a title lately, or not of a subtitle site", async () => {
    const { officials, fetchFile, later, fetched } = await setUp();
    expect(await officials.offer(offerOf(file(), { track: CAPTION }), fetchFile)).toBe("unknown_track");
    expect(await officials.offer(offerOf(file(), { track: "/api/subtitles/ro/never-listed.vtt" }), fetchFile)).toBe("unknown_track");
    later(13 * 3600 * 1000);
    expect(await officials.offer(offerOf(file()), fetchFile)).toBe("unknown_track");
    expect(fetched).toEqual([]);
  });

  it("is turned away when too little of the file was placed, or too little of it by words", async () => {
    const { officials, fetchFile } = await setUp();
    expect(await officials.offer(offerOf(file(), { skip: new Set([1, 2, 3, 4, 5, 6, 7]) }), fetchFile)).toBe("not_good_enough");
    expect(await officials.offer(offerOf(file(), { words: (i) => i % 2 === 0 }), fetchFile)).toBe("not_good_enough");
    expect(officials.size).toBe(0);
  });

  it("is turned away when its lines are not the file's", async () => {
    const { officials, fetchFile } = await setUp({ [OS]: file(61) });
    expect(await officials.offer(offerOf(file(60)), fetchFile)).toBe("different_file");
    const moved = offerOf(file(61));
    moved.lines = moved.lines.map((line) => (line ? [line[0] + 50, line[1], line[2], line[3]] : null));
    expect(await officials.offer(moved, fetchFile)).toBe("different_file");
    const none = await setUp({});
    expect(await none.officials.offer(offerOf(file()), none.fetchFile)).toBe("unavailable");
  });

  it("places a line the screen did not place as the lines either side of it moved", () => {
    const cues = [
      { start: 10, end: 12, text: "a" },
      { start: 20, end: 22, text: "b" },
      { start: 30, end: 32, text: "c" },
      { start: 40, end: 42, text: "d" },
    ];
    const offer: OfficialOffer = { v: 1, track: OS, duration: 100, lines: [null, [2000, 2100, 2300, 1], null, [4000, 4300, 4500, 1]] };
    expect(timesFromOffer(cues, offer).map((cue) => cue.start)).toEqual([11, 21, 32, 43]);
  });

  it("replaces the kept file only if it placed clearly more, and never one the team has been over", async () => {
    const { officials, store, fetchFile, later } = await setUp();
    const most = (i: number) => i % 10 !== 0;
    expect(await officials.offer(offerOf(file(), { words: most }), fetchFile)).toBe("taken");
    const id = officialId(PLAY, "en");
    const first = (await store.get(id))!.meta;
    expect(await officials.offer(offerOf(file(), { words: most, late: 3 }), fetchFile)).toBe("kept");
    later(1000);
    expect(BETTER_BY).toBeLessThan(0.1);
    expect(await officials.offer(offerOf(file(), { late: 3 }), fetchFile)).toBe("taken");
    const second = (await store.get(id))!;
    expect(second.meta.rev).not.toBe(first.rev);
    expect(second.meta.created).toBe(first.created);
    expect(second.lines[0]![0]).toBe(7300);

    const edited = second.lines.map(([start, end, text], line): [number, number, string] => [start, end, line === 0 ? "Line number one." : text]);
    const meta = await officials.edit(id, { lines: edited, note: "read through" });
    expect(meta).toMatchObject({ team: { note: "read through" } });
    expect((await store.get(id))!.source).toContainEqual([0, "Line number 1."]);
    expect(await officials.edit(id, { lines: edited.slice(1) })).toBe("different_lines");
    expect(await officials.offer(offerOf(file(), { late: 1 }), fetchFile)).toBe("kept");
    expect((await store.get(id))!.lines[0]).toEqual([7300, 7500, "Line number one."]);
  });

  it("gives the file of the newest version to a link of an older one, said to be older", async () => {
    const { officials, fetchFile, later } = await setUp();
    await officials.offer(offerOf(file(), { words: (i) => i % 10 !== 0 }), fetchFile);
    const id = officialId(PLAY, "en");
    const old = officials.list()[0]!.rev;
    later(1000);
    await officials.offer(offerOf(file()), fetchFile);
    const served = await officials.vtt(id, old);
    expect(served?.current).toBe(false);
    expect(await officials.vtt("0".repeat(20), old)).toBeUndefined();
  });

  it("keeps the most it may, letting the ones changed longest ago go first, but never one the team has been over", async () => {
    const { officials, fetchFile, later } = await setUp();
    const episodes = [1, 2, 3, 4].map((n) => `https://filmpire.sc/watch/60572?s=2&e=${10 + n}`);
    const ids: string[] = [];
    for (const [n, link] of episodes.entries()) {
      const url = `/api/subtitles/ro/e${n}.vtt`;
      officials.heard(link, played([track(0, "ro", url, "Română")]));
      later(1000);
      expect(await officials.offer(offerOf(file(), { track: url }), async () => file())).toBe("taken");
      ids.push(officialId(`filmpire:tv:60572:2:${11 + n}`, "ro"));
      if (n === 0) await officials.edit(ids[0]!, { lines: (await officials.get(ids[0]!))!.lines });
    }
    expect(officials.size).toBe(3);
    expect(officials.list().map((meta) => meta.id).sort()).toEqual([ids[0], ids[2], ids[3]].sort());
    void fetchFile;
  });
});

describe("withOfficial: the subtitles a Play is sent", () => {
  it("is the same answer when the title has none", async () => {
    const { officials } = await setUp();
    const answer = played(LISTED);
    expect(officials.withOfficial(EPISODE, answer)).toBe(answer);
    expect(officials.withOfficial("https://example.com/video", answer)).toBe(answer);
  });

  it("puts Romanian after the English tracks when there is no Romanian one, adds it to each source's own list, and changes nothing of the answer it was given", async () => {
    const { officials, fetchFile } = await setUp();
    expect(await officials.offer(offerOf(file(), { track: RO }), fetchFile)).toBe("taken");
    const given = played([track(0, "en", OS, "English"), track(1, "de", "/api/proxy?url=y", "Deutsch")], [{ subtitles: [track(0, "en", OS, "English")] }, {}]);
    const before = JSON.stringify(given);
    const answer = officials.withOfficial(EPISODE, given);
    expect(JSON.stringify(given)).toBe(before);
    if (answer.status !== "success") throw new Error("not a success");
    expect(answer.media.subtitles!.map((each) => [each.id, each.label])).toEqual([
      [0, "English"],
      [1, "Română · Kino Official"],
      [2, "Deutsch"],
    ]);
    expect(answer.media.alternates![0]!.subtitles!.map((each) => each.label)).toEqual(["English", "Română · Kino Official"]);
    expect(answer.media.alternates![1]!.subtitles).toBeUndefined();
  });

  it("sends no more than forty tracks", async () => {
    const { officials, fetchFile } = await setUp();
    await officials.offer(offerOf(file()), fetchFile);
    const many = Array.from({ length: 40 }, (_, i) => track(i, "en", `/api/proxy?url=${i}`, `English ${i}`));
    const answer = officials.withOfficial(EPISODE, played(many));
    if (answer.status !== "success") throw new Error("not a success");
    expect(answer.media.subtitles).toHaveLength(40);
    expect(answer.media.subtitles![0]!.label).toBe("English · Kino Official");
    expect(answer.media.subtitles!.map((each) => each.id)).toEqual([...Array(40).keys()]);
  });

  it("does not let another file be called a Kino Official one", async () => {
    const { officials } = await setUp();
    const answer = officials.withOfficial(EPISODE, played([track(0, "en", OS, "English · Kino Official"), track(1, "en", "/api/proxy?url=z", "kino  OFFICIAL")]));
    if (answer.status !== "success") throw new Error("not a success");
    expect(answer.media.subtitles!.map((each) => each.label)).toEqual(["English", "Subtitle"]);
  });
});

describe("what is kept", () => {
  it("is found again by a server that starts afresh", async () => {
    const { officials, store, fetchFile } = await setUp();
    await officials.offer(offerOf(file()), fetchFile);
    const again = await Officials.open({ store });
    const answer = again.withOfficial(EPISODE, played(LISTED));
    if (answer.status !== "success") throw new Error("not a success");
    expect(answer.media.subtitles![0]!.label).toBe("English · Kino Official");
    expect(await again.remove(officialId(PLAY, "en"))).toBe(true);
    expect(again.withOfficial(EPISODE, played(LISTED))).toMatchObject({ media: { subtitles: LISTED } });
  });

  it("is none, and a warning, when the store cannot be read", async () => {
    const warned: string[] = [];
    const broken = { metas: async () => Promise.reject(new Error("down")), get: async () => undefined, put: async () => {}, remove: async () => {} };
    const officials = await Officials.open({ store: broken, log: { warn: (message) => warned.push(message) } });
    expect(officials.size).toBe(0);
    expect(warned[0]).toContain("down");
  });
});
