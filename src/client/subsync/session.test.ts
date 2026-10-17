import { describe, expect, it } from "vitest";
import { mergeTimings, type SharedPlacement, type SharedTiming } from "../../shared";
import { DirectBackend, type Backend } from "./backend";
import { SyncCore } from "./core";
import type { Cue } from "./cues";
import { markNoLanguage, release } from "./hold";
import { SyncSession, type CueLike, type HlsLike, type SyncStatus, type TrackLike } from "./session";
import { timingKeys, type Sent, type Shared } from "./share";
import type { Word } from "./signals";
import { alignerStats } from "./stats";
import { AudioTap } from "./tap";
import { LoudnessVad, makeAudio, makeFilm, misTimed, type Film } from "./synth";
import type { Recogniser } from "./whistle";

const PIECE = 10;
const SECONDS = 300;
const film = makeFilm(11, SECONDS);
/** Another film's captions: the words of a wrong release. */
const other = makeFilm(97, SECONDS);

class FakeCue implements CueLike {
  constructor(
    public startTime: number,
    public endTime: number,
    readonly text: string,
  ) {}
}

/** A subtitle track the way the browser has it: the lines are there once it is on (hidden or showing), not while it is disabled. */
class FakeTrack implements TrackLike {
  readonly kind = "subtitles";
  mode: "disabled" | "hidden" | "showing" = "disabled";
  readonly lines: FakeCue[];
  constructor(
    readonly language: string,
    readonly label: string,
    cues: Cue[],
  ) {
    this.lines = cues.map((cue) => new FakeCue(cue.start, cue.end, cue.text));
  }
  get cues(): ArrayLike<CueLike> | null {
    return this.mode === "disabled" ? null : this.lines;
  }
}

class FakeHls implements HlsLike {
  audioTracks: Array<{ lang?: string }> | undefined;
  audioTrack = 0;
  subtitleTracks: unknown[] = [];
  private readonly listeners = new Map<string, Set<(event: string, data: never) => void>>();
  on(event: string, listener: (event: string, data: never) => void): void {
    this.listeners.set(event, (this.listeners.get(event) ?? new Set()).add(listener));
  }
  off(event: string, listener: (event: string, data: never) => void): void {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event: string, data: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(event, data as never);
  }
}

const APPENDING = "hlsBufferAppending";
const SWITCHING = "hlsAudioTrackSwitching";

/** What the player hands over: an init segment once, then a piece for every ten seconds; the bytes only say which sound they stand for. */
const initSegment = (): Uint8Array => Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
function piece(start: number): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0, 0, 0, 16, 0x6d, 0x6f, 0x6f, 0x66]);
  new DataView(bytes.buffer).setUint32(8, Math.round(start * 1000), true);
  return bytes;
}
const event = (data: Uint8Array, start: number) => ({ type: "audio", data, frag: { start, duration: PIECE, elementaryStreams: { audio: { startPTS: start, endPTS: start + PIECE } } } });

const sound = new Map<number, Float32Array>();
const soundAt = (start: number): Float32Array => {
  let pcm = sound.get(start);
  if (!pcm) sound.set(start, (pcm = makeAudio(film, start, start + PIECE)));
  return pcm;
};
/** "Decoding" the bytes above gives the film's sound for that piece. */
const decode = async (bytes: Uint8Array): Promise<Float32Array> => soundAt(new DataView(bytes.buffer, bytes.byteOffset).getUint32(bytes.length - 8, true) / 1000);

/** A recogniser that writes down what the film's sound says, found out from the sound it is handed. */
function listener(options: { heard?: number[] } = {}): Recogniser {
  return {
    async hear(pcm: Float32Array): Promise<Word[]> {
      for (let from = 0; from + 15 <= SECONDS; from += 15) {
        const reference = soundAt(Math.floor(from / PIECE) * PIECE);
        const base = Math.round((from - Math.floor(from / PIECE) * PIECE) * 16000);
        let same = true;
        for (let i = 0; i < 64 && same; i++) same = Math.abs((reference[base + i] as number) - (pcm[i] as number)) < 2e-4;
        if (!same) continue;
        options.heard?.push(from);
        return film.words.filter((w) => w.start >= from && w.start < from + 15).map((w) => ({ ...w, start: w.start - from, end: w.end - from }));
      }
      return [];
    },
    close() {},
  };
}

interface Rigging {
  tracks: FakeTrack[];
  shown?: number;
  audioLang?: string;
  recogniser?: () => Promise<Recogniser>;
  decode?: (bytes: Uint8Array) => Promise<Float32Array>;
  backend?: () => Promise<Backend>;
  shared?: Shared;
  show?: (id: number) => void;
}

/** A film with its tracks, a player to feed the aligner, and the aligner. */
class Rig {
  readonly hls = new FakeHls();
  /** What the player listens to the sound with: it is there from the start of the film, whatever the aligner is doing. */
  readonly tap = new AudioTap(this.hls, APPENDING);
  readonly video: { currentTime: number; playbackRate: number; duration: number; textTracks: FakeTrack[] };
  readonly statuses: SyncStatus[] = [];
  readonly shows: number[] = [];
  readonly logs: string[] = [];
  recogniserCalls = 0;
  backendCalls = 0;
  decodeCalls = 0;
  session: SyncSession;
  private fed = 0;
  private clock = 0;

  constructor(private readonly rigging: Rigging) {
    this.video = { currentTime: 0, playbackRate: 1, duration: SECONDS, textTracks: rigging.tracks };
    if (rigging.audioLang) this.hls.audioTracks = [{ lang: rigging.audioLang }];
    if (rigging.shown !== undefined) rigging.tracks[rigging.shown]!.mode = "hidden";
    this.session = this.newSession();
  }

  private newSession(): SyncSession {
    const { rigging } = this;
    return new SyncSession({
      video: this.video,
      hls: this.hls,
      events: { audioSwitching: SWITCHING },
      tap: this.tap,
      show: (id) => {
        this.shows.push(id);
        this.pick(id);
        rigging.show?.(id);
      },
      backend: () => {
        this.backendCalls++;
        return (rigging.backend ?? (async () => new DirectBackend(new SyncCore(new LoudnessVad()))))();
      },
      recogniser: () => {
        this.recogniserCalls++;
        return (rigging.recogniser ?? (async () => listener()))();
      },
      decode: (bytes) => {
        this.decodeCalls++;
        return (rigging.decode ?? decode)(bytes);
      },
      ...(rigging.shared ? { shared: rigging.shared } : {}),
      report: (status) => this.statuses.push(status),
      now: () => this.clock,
      log: (message) => this.logs.push(message),
    });
  }

  /** The viewer turns the aligner off (the lines go back) and on again in the middle of the film: a new aligner on the same player. */
  restart(): void {
    this.session.close(true);
    this.session = this.newSession();
  }

  /** Time goes by (the clock the aligner keeps its own time by) without the film moving. */
  pass(ms: number): void {
    this.clock += ms;
  }

  /** What the engine does for a track chosen in the menu: that one hidden, the others off, nothing held any more. */
  pick(id: number): void {
    this.rigging.tracks.forEach((track, i) => {
      release(track);
      track.mode = i === id ? "hidden" : "disabled";
    });
  }

  get shown(): number {
    return this.rigging.tracks.findIndex((track) => track.mode !== "disabled");
  }

  /** Lets the aligner look at the tracks and do what there is to do, until it has nothing more (a few times: it starts things that finish a moment later). */
  async settle(): Promise<void> {
    for (let round = 0; round < 6; round++) {
      await this.session.settle();
      this.session.tick();
      let steps = 0;
      while (steps++ < 80 && (await this.session.work())) this.session.tick();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  /** The film plays on to `seconds`: the player downloads it a piece at a time, forty seconds ahead of the picture. */
  async play(seconds: number): Promise<void> {
    if (this.fed === 0) this.hls.emit(APPENDING, event(initSegment(), 0));
    while (this.fed < seconds) {
      this.hls.emit(APPENDING, event(piece(this.fed), this.fed));
      this.fed += PIECE;
      this.video.currentTime = Math.max(0, this.fed - 40);
      this.clock += 1000;
      await this.settle();
    }
  }

  /** Where the lines of track `index` are now, against when they were really said: the share of those from `from` to `to` that are within `tolerance`. */
  within(index: number, tolerance: number, from: number, to: number): number {
    const track = this.rigging.tracks[index] as FakeTrack;
    const pairs = film.truth.map((cue, i) => ({ cue, line: track.lines[i] as FakeCue })).filter(({ cue }) => cue.start >= from && cue.start < to);
    return pairs.filter(({ cue, line }) => Math.abs(line.startTime - cue.start) <= tolerance).length / Math.max(1, pairs.length);
  }
}

const track = (label: string, cues: Cue[], language = "en") => new FakeTrack(language, label, cues);
const late = (seconds: number) => misTimed(film, () => -seconds);

describe("timing the subtitles of a film while it plays", () => {
  it("puts a track that is three seconds late where it is said, and says so", { timeout: 120_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0 });
    await rig.play(SECONDS);
    expect(rig.within(0, 0.5, 20, 250)).toBeGreaterThan(0.9);
    expect(rig.session.status()).toBe("synced");
    expect(rig.recogniserCalls).toBe(1);
    expect(rig.shows).toEqual([]);
    rig.session.close();
  });

  it("leaves a track that is right alone, and does not touch the other English tracks that the film has", { timeout: 120_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", late(2)), track("English 2", late(4)), track("Romanian", late(1), "ro")], shown: 0 });
    await rig.play(SECONDS);
    expect(rig.shows).toEqual([]);
    expect(rig.shown).toBe(0);
    expect(rig.within(0, 0.5, 20, 250)).toBeGreaterThan(0.9);
    // (The other tracks were not even switched on.)
    expect(rig.video.textTracks[1]!.mode).toBe("disabled");
    rig.session.close();
  });

  it("replaces a track that is another film's with the English one that fits, between two lines, and times that one", { timeout: 180_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", misTimed(other, () => -1)), track("English 2", late(2.5))], shown: 0 });
    await rig.play(SECONDS);
    expect(rig.shows).toEqual([1]);
    expect(rig.shown).toBe(1);
    expect(rig.within(1, 0.5, 190, 250)).toBeGreaterThan(0.85);
    expect(rig.session.status()).toBe("synced");
    rig.session.close();
  });

  it("does not change the track once the viewer has chosen one themselves", { timeout: 180_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", misTimed(other, () => -1)), track("English 2", late(2.5)), track("English 3", misTimed(other, () => 2))], shown: 0 });
    await rig.play(60);
    rig.pick(2); // (the viewer, from the menu)
    await rig.play(SECONDS);
    expect(rig.shows).toEqual([]);
    expect(rig.shown).toBe(2);
    rig.session.close();
  });

  it("times a track in another language from the English one, which it pairs with", { timeout: 180_000 }, async () => {
    // (Same film, other words, and its own offset: the lines start where the English ones do, less a second or so.)
    const romanian = misTimed(film, () => -1.1).map((cue, i) => ({ ...cue, text: `romana ${i}` }));
    const rig = new Rig({ tracks: [track("Romanian", romanian, "ro"), track("English", late(3))], shown: 0 });
    await rig.play(SECONDS);
    expect(rig.recogniserCalls).toBe(1);
    expect(rig.within(0, 0.6, 230, 270)).toBeGreaterThan(0.85);
    expect(rig.shows).toEqual([]);
    expect(rig.shown).toBe(0);
    rig.session.close();
  });

  it("puts the lines back where the file had them when it is turned off", { timeout: 120_000 }, async () => {
    const original = late(3);
    const rig = new Rig({ tracks: [track("English", original)], shown: 0 });
    await rig.play(150);
    expect(rig.within(0, 0.5, 20, 100)).toBeGreaterThan(0.8);
    rig.session.close(true);
    const lines = rig.video.textTracks[0]!.lines;
    expect(lines.every((line, i) => line.startTime === original[i]!.start && line.endTime === original[i]!.end)).toBe(true);
  });
});

describe("when it cannot, or has nothing to do", () => {
  it("does nothing while no subtitles are on (and downloads no recogniser)", { timeout: 60_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", late(3))] });
    await rig.play(60);
    expect(rig.recogniserCalls).toBe(0);
    expect(rig.session.status()).toBe("ready");
    rig.session.close();
  });

  it("does not start the recogniser over sound that is known not to be English", { timeout: 60_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0, audioLang: "ja" });
    await rig.play(90);
    expect(rig.recogniserCalls).toBe(0);
    rig.session.close();
  });

  it("goes on with the voice detector alone when the recogniser cannot start", { timeout: 60_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0, recogniser: () => Promise.reject(new Error("no memory")) });
    await rig.play(90);
    expect(rig.logs.some((line) => line.includes("no memory"))).toBe(true);
    expect(rig.session.status()).not.toBe("unavailable");
    rig.session.close();
  });

  it("says it is unavailable when the sound cannot be read", { timeout: 60_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0, decode: () => Promise.reject(new Error("no codec")) });
    await rig.play(60);
    expect(rig.session.status()).toBe("unavailable");
    expect(rig.statuses.at(-1)).toBe("unavailable");
  });

  it("is not unavailable just because the viewer turned it off while the voice detector was at work", { timeout: 60_000 }, async () => {
    // (The one in the worker fails the work it still has when it is closed: that is the viewer's doing, not a failure of the aligner.)
    class Busy extends DirectBackend {
      private fail: ((error: Error) => void) | undefined;
      override addAudio(): Promise<number> {
        return new Promise<number>((_resolve, reject) => void (this.fail = reject));
      }
      override close(): void {
        this.fail?.(new Error("The aligner was closed"));
      }
    }
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0, backend: async () => new Busy(new SyncCore(new LoudnessVad())) });
    rig.hls.emit(APPENDING, event(initSegment(), 0));
    rig.hls.emit(APPENDING, event(piece(0), 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    rig.session.close(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(rig.statuses).not.toContain("unavailable");
    expect(rig.logs).toEqual([]);
  });

  it("leaves subtitles that come in the stream to the player", { timeout: 60_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0 });
    rig.hls.subtitleTracks = [{}];
    rig.session.tick();
    expect(rig.session.status()).toBe("unavailable");
  });

  it("starts over when the audio track changes", { timeout: 120_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0 });
    await rig.play(100);
    rig.hls.emit(SWITCHING, {});
    await rig.settle();
    expect(rig.session.status()).toBe("syncing");
    rig.session.close();
  });
});

describe("starting only when there is something to time", () => {
  it("fetches no worker and decodes nothing while no subtitles are on, and times the sound that came meanwhile once they are", { timeout: 180_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", late(3))] });
    await rig.play(90);
    expect(rig.backendCalls).toBe(0);
    expect(rig.decodeCalls).toBe(0);
    expect(rig.recogniserCalls).toBe(0);
    expect(rig.session.status()).toBe("ready");
    rig.pick(0); // (the viewer turns the subtitles on)
    await rig.settle();
    expect(rig.backendCalls).toBe(1);
    expect(rig.decodeCalls).toBeGreaterThan(5);
    expect(rig.within(0, 1, 10, 50)).toBeGreaterThan(0.6);
    rig.session.close();
  });

  it("stops decoding when the subtitles are turned off, and goes on with the sound that was kept when they are turned on again", { timeout: 180_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0 });
    await rig.play(60);
    rig.pick(-1);
    rig.session.tick();
    const decoded = rig.decodeCalls;
    expect(decoded).toBeGreaterThan(3);
    await rig.play(120);
    expect(rig.decodeCalls).toBe(decoded);
    rig.pick(0);
    await rig.settle();
    expect(rig.decodeCalls).toBeGreaterThan(decoded);
    rig.session.close();
  });

  it("hears the rest of the film when it is turned off and on again in the middle of it (the init segment of the sound came once, at the start)", { timeout: 180_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0 });
    await rig.play(60);
    rig.restart();
    await rig.play(200);
    expect(rig.backendCalls).toBe(2);
    expect(rig.within(0, 0.6, 90, 160)).toBeGreaterThan(0.8);
    rig.session.close();
  });

  it("keeps what it has found when hls.js says the same sound track again, and starts over for another one", { timeout: 180_000 }, async () => {
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0, audioLang: "en" });
    await rig.play(100);
    expect(rig.session.status()).toBe("synced");
    rig.hls.emit(SWITCHING, { lang: "en" }); // (a variant of the film that has its audio in another group)
    await rig.settle();
    expect(rig.session.status()).toBe("synced");
    rig.hls.emit(SWITCHING, { lang: "fr", name: "Français" });
    await rig.settle();
    expect(rig.session.status()).toBe("syncing");
    rig.session.close();
  });
});

describe("tracks of another language, and tracks that say none", () => {
  it("moves the lines of a track in another language by that track's own shift, not by the English track's", { timeout: 240_000 }, async () => {
    // (The English file is three seconds late and the Romanian one only a second: lines the aligner has not reached must not be moved by three.)
    const romanian = misTimed(film, () => -1.1).map((cue, i) => ({ ...cue, text: `romana ${i}` }));
    const rig = new Rig({ tracks: [track("Romanian", romanian, "ro"), track("English", late(3))], shown: 0 });
    await rig.play(210);
    expect(rig.within(0, 0.6, 250, 290)).toBeGreaterThan(0.85);
    rig.session.close();
  });

  it("does not take a track that the provider gave no language for as English, and so does not replace it with an English one", { timeout: 240_000 }, async () => {
    // (Its text is another film's, as a Romanian file's would be next to English speech: the page labels it "en" only because it has to label it.)
    const tracks = [track("Română", misTimed(other, () => -1)), track("English 2", late(2.5))];
    markNoLanguage(tracks[0]!);
    const rig = new Rig({ tracks, shown: 0 });
    await rig.play(SECONDS);
    expect(rig.shows).toEqual([]);
    expect(rig.shown).toBe(0);
    rig.session.close();
  });

  it("puts in place the lines it timed while the track was not on screen, when the track comes up", { timeout: 240_000 }, async () => {
    // (The English track times the Romanian one without being on screen; then the viewer picks the English one.)
    const romanian = misTimed(film, () => -1.1).map((cue, i) => ({ ...cue, text: `romana ${i}` }));
    const rig = new Rig({ tracks: [track("Romanian", romanian, "ro"), track("English", late(3))], shown: 0 });
    await rig.play(SECONDS);
    rig.pick(1);
    await rig.settle();
    expect(rig.within(1, 0.6, 110, 160)).toBeGreaterThan(0.8);
    rig.session.close();
  });
});

describe("testing a track against the words", () => {
  it("goes by the newest words when the first minutes never hold enough of them (a quiet opening, or a device that hears only some windows)", { timeout: 240_000 }, async () => {
    class Thin extends DirectBackend {
      override async score(cues: Cue[], latest = false) {
        const score = await super.score(cues, latest);
        return latest ? score : { ...score, words: Math.min(score.words, 20) };
      }
    }
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0, backend: async () => new Thin(new SyncCore(new LoudnessVad())) });
    await rig.play(SECONDS);
    expect(alignerStats.verdict).toBe("right");
    rig.session.close();
  });
});

describe("giving up", () => {
  it("gives the lines back when the viewer turns it off after it gave up", { timeout: 240_000 }, async () => {
    // (A device that cannot keep up with the voice detector: what it had timed stays, and the viewer's switch still puts the file's times back.)
    class Slow extends DirectBackend {
      override async addAudio(time: number, pcm: Float32Array): Promise<number> {
        await super.addAudio(time, pcm);
        return time >= 100 ? 100_000 : 0;
      }
    }
    const original = late(3);
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, backend: async () => new Slow(new SyncCore(new LoudnessVad())) });
    await rig.play(200);
    expect(rig.session.status()).toBe("unavailable");
    expect(rig.within(0, 0.6, 20, 60)).toBeGreaterThan(0.8);
    rig.session.close(true);
    const lines = rig.video.textTracks[0]!.lines;
    expect(lines.every((line, i) => line.startTime === original[i]!.start && line.endTime === original[i]!.end)).toBe(true);
  });
});

/** The server's shared timings, in memory: what a screen leaves is joined to what is kept, as the server does. */
class FakeShared implements Shared {
  readonly kept = new Map<string, SharedTiming>();
  readonly puts: Array<{ key: string; timing: SharedTiming; keepalive: boolean }> = [];
  readonly asked: string[] = [];
  failPuts = 0;
  /** What the server says to everything it is sent, when it is to say the same to all (nothing is kept then). */
  answer: Sent | undefined;
  async get(key: string): Promise<SharedTiming | undefined> {
    this.asked.push(key);
    return this.kept.get(key);
  }
  async put(key: string, timing: SharedTiming, keepalive = false): Promise<Sent> {
    this.puts.push({ key, timing, keepalive });
    if (this.answer) return this.answer;
    if (this.failPuts > 0) {
      this.failPuts--;
      return "failed";
    }
    const merged = mergeTimings(this.kept.get(key), timing);
    if (merged) this.kept.set(key, merged);
    return merged ? "taken" : "refused";
  }
}

/** The timing a screen that had timed `cues` perfectly would have left: every line the film says between `from` and `to`, where it was really said (plus `off` seconds). */
function entryFor(cues: Cue[], options: { from?: number; to?: number; off?: number; words?: boolean } = {}): SharedTiming {
  const { from = 0, to = Infinity, off = 0, words = true } = options;
  const placed: SharedPlacement[] = [];
  film.truth.forEach((truth, i) => {
    const cue = cues[i];
    if (!cue || truth.start < from || truth.start >= to) return;
    placed.push([i, Math.round((truth.start + off - cue.start) * 100), Math.round((truth.end + off - cue.end) * 100), words ? 1 : 0]);
  });
  return { v: 1, lines: cues.length, placed };
}

/** The name a screen of this film (SECONDS long, sound in no language we know) gives the timing of a file. */
const keyOf = (cues: Cue[]): string => timingKeys({ duration: SECONDS, audio: undefined, cues })![0] as string;
const quiet = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe("timings that screens leave each other", () => {
  it("leaves what it has found right, for the next screen to start from", { timeout: 120_000 }, async () => {
    const shared = new FakeShared();
    const original = late(3);
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, shared });
    await rig.play(200);
    rig.session.flush(); // (the page is closing)
    await quiet();
    const kept = shared.kept.get(keyOf(original));
    expect(kept?.lines).toBe(original.length);
    expect(kept?.placed.length).toBeGreaterThan(20);
    // (Moved about three seconds earlier, which is what was wrong with the file.)
    expect((kept?.placed ?? []).filter((each) => Math.abs(each[1] + 300) <= 60).length / (kept?.placed.length ?? 1)).toBeGreaterThan(0.85);
    expect(shared.puts.every((put) => put.key === keyOf(original))).toBe(true);
    expect(shared.puts.at(-1)?.keepalive).toBe(true);
    rig.session.close();
  });

  it("leaves nothing while it is not known that the track is the film's", { timeout: 60_000 }, async () => {
    const shared = new FakeShared();
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0, shared });
    await rig.play(40);
    rig.pass(10 * 60_000);
    rig.session.tick();
    rig.session.flush();
    expect(shared.puts).toEqual([]);
    rig.session.close();
  });

  it("leaves it every few minutes, not only at the end, and only what it has not left before", { timeout: 120_000 }, async () => {
    const shared = new FakeShared();
    const original = late(3);
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, shared });
    await rig.play(150);
    expect(shared.puts).toEqual([]);
    rig.pass(4 * 60_000);
    rig.session.tick();
    await quiet();
    expect(shared.puts).toHaveLength(1);
    const first = shared.puts[0]!.timing.placed.length;
    expect(shared.puts[0]!.keepalive).toBe(false);
    await rig.play(250);
    rig.pass(4 * 60_000);
    rig.session.tick();
    await quiet();
    expect(shared.puts).toHaveLength(2);
    const lines = new Set(shared.puts[0]!.timing.placed.map((each) => each[0]));
    expect(shared.puts[1]!.timing.placed.every((each) => !lines.has(each[0]))).toBe(true);
    expect(first).toBeGreaterThan(10);
    rig.session.close();
  });

  it("tries again to leave what the server did not take", { timeout: 120_000 }, async () => {
    const shared = new FakeShared();
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0, shared });
    await rig.play(200);
    shared.failPuts = 1;
    rig.session.flush();
    await quiet();
    rig.session.flush();
    await quiet();
    expect(shared.puts).toHaveLength(2);
    expect(shared.puts[1]!.timing).toEqual(shared.puts[0]!.timing);
    rig.session.flush(); // (now the server has it)
    await quiet();
    expect(shared.puts).toHaveLength(2);
    rig.session.close();
  });

  it("puts in place a timing that another screen left once its own work agrees with it, and then has no use for the recogniser", { timeout: 120_000 }, async () => {
    const shared = new FakeShared();
    const original = late(3);
    shared.kept.set(keyOf(original), entryFor(original));
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, shared });
    await rig.play(90);
    // (Lines far past what has been downloaded are where they are said already.)
    expect(rig.within(0, 0.5, 150, 290)).toBeGreaterThan(0.9);
    expect(rig.recogniserCalls).toBe(0);
    expect(rig.session.status()).toBe("synced");
    expect(alignerStats.shared).toBe("believed (all of it)");
    expect(alignerStats.recogniser).not.toBe("running");
    rig.session.close();
  });

  it("does nothing with a timing before its own work has agreed with it", { timeout: 60_000 }, async () => {
    const shared = new FakeShared();
    const original = late(3);
    shared.kept.set(keyOf(original), entryFor(original));
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, shared });
    await rig.play(10);
    await rig.settle();
    expect(alignerStats.shared).toBe("checking");
    // (The lines far ahead are as the file had them.)
    expect(rig.within(0, 0.5, 150, 290)).toBeLessThan(0.1);
    rig.session.close();
  });

  it("does not believe a timing that does not fit what it hears, and does the work itself", { timeout: 180_000 }, async () => {
    const shared = new FakeShared();
    const original = late(3);
    shared.kept.set(keyOf(original), entryFor(original, { off: 20 }));
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, shared });
    await rig.play(SECONDS);
    expect(alignerStats.shared).toBe("rejected");
    expect(rig.recogniserCalls).toBe(1);
    expect(rig.within(0, 0.5, 20, 250)).toBeGreaterThan(0.9);
    expect(rig.session.status()).toBe("synced");
    rig.session.close();
  });

  it("leaves the recogniser to the part of the film that a timing does not place", { timeout: 180_000 }, async () => {
    const shared = new FakeShared();
    const original = late(3);
    shared.kept.set(keyOf(original), entryFor(original, { to: 110 }));
    const heard: number[] = [];
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, shared, recogniser: async () => listener({ heard }) });
    await rig.play(SECONDS);
    expect(alignerStats.shared).toBe("believed (part)");
    expect(heard.length).toBeGreaterThan(5);
    expect(heard.filter((from) => from + 15 <= 100)).toEqual([]);
    expect(rig.within(0, 0.5, 20, 250)).toBeGreaterThan(0.9);
    rig.session.close();
  });

  it("does not fetch the recogniser while a timing places everything near the picture, and does when the picture gets to the rest", { timeout: 180_000 }, async () => {
    const shared = new FakeShared();
    const original = late(3);
    shared.kept.set(keyOf(original), entryFor(original, { to: 200 }));
    const heard: number[] = [];
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, shared, recogniser: async () => listener({ heard }) });
    await rig.play(120);
    expect(alignerStats.shared).toBe("believed (part)");
    expect(rig.recogniserCalls).toBe(0);
    await rig.play(SECONDS);
    expect(rig.recogniserCalls).toBe(1);
    expect(heard.length).toBeGreaterThan(0);
    expect(heard.every((from) => from >= 180)).toBe(true);
    rig.session.close();
  });

  it("does not make a timing's lines worse where the voice detector alone is at work on them", { timeout: 120_000 }, async () => {
    // (The timing is exact, with words; what the voice detector alone finds is a little off. The lines stay as the timing has them.)
    const shared = new FakeShared();
    const original = late(3);
    shared.kept.set(keyOf(original), entryFor(original));
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, shared });
    await rig.play(200);
    expect(rig.within(0, 0.05, 20, 200)).toBeGreaterThan(0.95);
    rig.session.close();
  });

  it("keeps the lines of a believed timing when the voice detector alone finds some far from them, with or without words in the timing: a stretch decides, not a line", { timeout: 120_000 }, async () => {
    // (On real sound the voice detector is a second or three off all through a stretch, and now and then four or five on a line; the timing was made with more to go by.)
    const shared = new FakeShared();
    const original = late(3);
    const entry = entryFor(original, { off: 1, words: false });
    const far = (line: number) => line % 9 === 4; // (these are six seconds further than the rest: past the bar for a line, in a stretch that mostly is where the voice detector finds it)
    const skewed = { ...entry, placed: entry.placed.map((each) => (far(each[0]) ? ([each[0], each[1] + 600, each[2] + 600, each[3]] as SharedPlacement) : each)) };
    shared.kept.set(keyOf(original), skewed);
    const english = track("English", original);
    const rig = new Rig({ tracks: [english], shown: 0, shared });
    await rig.play(200);
    expect(alignerStats.shared).toMatch(/^believed/);
    let checked = 0;
    for (const [line, startMoved] of skewed.placed) {
      if (film.truth[line]!.start < 20 || film.truth[line]!.start >= 150) continue;
      expect(english.lines[line]!.startTime, `line ${line}`).toBeCloseTo(original[line]!.start + startMoved / 100, 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    rig.session.close();
  });

  it("leaves nothing of a timing it believed, not even the lines it had placed itself before it believed it (they are the timing's now)", { timeout: 120_000 }, async () => {
    const shared = new FakeShared();
    const original = late(3);
    shared.kept.set(keyOf(original), entryFor(original, { off: 1, words: false }));
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, shared });
    await rig.play(200);
    expect(alignerStats.shared).toMatch(/^believed/);
    rig.pass(10 * 60_000);
    rig.session.tick();
    rig.session.flush();
    await quiet();
    expect(shared.puts).toEqual([]);
    rig.session.close();
  });

  it("ignores a timing for a file with another number of lines, and a server that cannot be reached", { timeout: 60_000 }, async () => {
    const original = late(3);
    const shared = new FakeShared();
    shared.kept.set(keyOf(original), { ...entryFor(original), lines: original.length + 1 });
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, shared });
    await rig.play(60);
    expect(alignerStats.shared).toBe("none found");
    expect(rig.recogniserCalls).toBe(1); // (not held up)
    rig.session.close();

    const broken: Shared = { get: () => Promise.reject(new Error("offline")), put: () => Promise.reject(new Error("offline")) };
    const again = new Rig({ tracks: [track("English", late(3))], shown: 0, shared: broken });
    await again.play(200);
    expect(again.within(0, 0.5, 20, 100)).toBeGreaterThan(0.9);
    again.session.flush();
    again.session.close();
  });

  it("leaves nothing under the name of a track that was found wrong, and the right one when the aligner switches to it", { timeout: 180_000 }, async () => {
    const shared = new FakeShared();
    const bad = misTimed(other, () => -1);
    const good = late(2.5);
    const rig = new Rig({ tracks: [track("English", bad), track("English 2", good)], shown: 0, shared });
    await rig.play(SECONDS);
    rig.session.flush();
    await quiet();
    expect(rig.shown).toBe(1);
    expect(shared.puts.length).toBeGreaterThan(0);
    expect(shared.puts.every((put) => put.key === keyOf(good))).toBe(true);
    expect(shared.kept.has(keyOf(bad))).toBe(false);
    rig.session.close();
  });

  it("leaves the timing of a track in another language under that track's own name", { timeout: 180_000 }, async () => {
    const shared = new FakeShared();
    const romanian = misTimed(film, () => -1.1).map((cue, i) => ({ ...cue, text: `romana ${i}` }));
    const english = late(3);
    const rig = new Rig({ tracks: [track("Romanian", romanian, "ro"), track("English", english)], shown: 0, shared });
    await rig.play(SECONDS);
    rig.session.flush();
    await quiet();
    expect(shared.puts.length).toBeGreaterThan(0);
    expect(shared.puts.every((put) => put.key === keyOf(romanian))).toBe(true);
    const kept = shared.kept.get(keyOf(romanian));
    expect(kept?.lines).toBe(romanian.length);
    expect(kept?.placed.length).toBeGreaterThan(20);
    rig.session.close();
  });

  it("asks again for another sound when the audio track changes, and leaves nothing of the old", { timeout: 120_000 }, async () => {
    const shared = new FakeShared();
    const original = late(3);
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, shared });
    await rig.play(200);
    rig.hls.audioTracks = [{ lang: "fr" }, { lang: "en" }];
    rig.hls.audioTrack = 0;
    rig.hls.emit(SWITCHING, {});
    await rig.settle();
    rig.session.flush();
    await quiet();
    expect(new Set(shared.asked).size).toBe(4); // (two names for a film's length, and the sound is part of them)
    expect(shared.puts).toEqual([]); // (the lines of the sound before the switch are not the new sound's)
    rig.session.close();
  });

  it("goes by what it hears where a believed timing is far off (right at the start of the film, wrong after it)", { timeout: 240_000 }, async () => {
    const shared = new FakeShared();
    const original = late(3);
    const right = entryFor(original, { to: 120 });
    const wrong = entryFor(original, { from: 120, off: 20 });
    shared.kept.set(keyOf(original), { v: 1, lines: original.length, placed: [...right.placed, ...wrong.placed] });
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, shared });
    await rig.play(SECONDS);
    expect(alignerStats.shared).toMatch(/^believed/);
    // (What is right stays as the timing has it, to the hundredth of a second; the rest is no more than what the voice detector alone makes of it.)
    expect(rig.within(0, 0.05, 20, 110)).toBeGreaterThan(0.9);
    expect(rig.within(0, 2.5, 140, 260)).toBeGreaterThan(0.8);
    rig.session.close();
  });

  it("leaves its timing under the name it found one under, so that the screens either side of a length's edge share one", { timeout: 240_000 }, async () => {
    const shared = new FakeShared();
    const original = late(3);
    const keys = timingKeys({ duration: SECONDS, audio: undefined, cues: original })!;
    expect(keys).toHaveLength(2);
    shared.kept.set(keys[1]!, entryFor(original, { to: 110 }));
    const rig = new Rig({ tracks: [track("English", original)], shown: 0, shared });
    await rig.play(SECONDS);
    rig.session.flush();
    await quiet();
    expect(shared.puts.length).toBeGreaterThan(0);
    expect(shared.puts.every((put) => put.key === keys[1])).toBe(true);
    expect(shared.kept.has(keys[0]!)).toBe(false);
    rig.session.close();
  });

  it("does not send again, every few minutes, what the server has refused for good", { timeout: 240_000 }, async () => {
    const shared = new FakeShared();
    shared.answer = "refused";
    const rig = new Rig({ tracks: [track("English", late(3))], shown: 0, shared });
    await rig.play(200);
    rig.session.flush();
    await quiet();
    rig.pass(10 * 60_000);
    rig.session.tick();
    rig.session.flush();
    await quiet();
    expect(shared.puts).toHaveLength(1);
    rig.session.close();
  });
});
