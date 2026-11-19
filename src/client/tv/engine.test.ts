import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hold, isHeld } from "../subsync/hold";
import { AudioTap } from "../subsync/tap";
import { signedRelayUrl } from "../../server/streamRelay/links";
import {
  BACK_BUFFER_S,
  DELAY_REACH_S,
  DIRECT_START_MS,
  LITE_BUFFER,
  LONE_PROXY_BUFFER_AHEAD_S,
  LONE_PROXY_BUFFER_BYTES,
  PARTY_BUFFER_AHEAD_S,
  PARTY_BUFFER_BYTES,
  PlayerEngine,
  QUALITY_GIVE_UPS,
  bufferPolicy,
  describeHlsError,
  lostTheConnection,
  lowFirstLevel,
  proxiedQualityCap,
  readableFrom,
  sourceSaidNo,
  type SyncFilm,
  type SyncStarter,
} from "./engine";

const FakeHls = vi.hoisted(() => {
  type Handler = (event: string, data: unknown) => void;
  class FakeHls {
    static supported = true;
    static instances: FakeHls[] = [];
    static isSupported = () => FakeHls.supported;
    static Events = {
      ERROR: "error",
      MANIFEST_PARSED: "manifestParsed",
      LEVEL_SWITCHED: "ls",
      LEVEL_LOADED: "ll",
      SUBTITLE_TRACK_SWITCH: "sts",
      SUBTITLE_TRACKS_UPDATED: "stu",
      AUDIO_TRACK_SWITCHED: "ats",
      AUDIO_TRACKS_UPDATED: "atu",
      BUFFER_APPENDING: "bufferAppending",
      AUDIO_TRACK_SWITCHING: "audioTrackSwitching",
      FRAG_LOADED: "fragLoaded",
      LEVEL_UPDATED: "levelUpdated",
    };
    static ErrorTypes = { MEDIA_ERROR: "mediaError", NETWORK_ERROR: "networkError" };
    handlers = new Map<string, Handler[]>();
    url: string | null = null;
    autoLevelCapping = -1;
    currentLevel = -1;
    manualLevel = -1;
    loadLevelWrites: number[] = [];
    set loadLevel(level: number) {
      this.loadLevelWrites.push(level);
      this.manualLevel = level;
    }
    subtitleDisplay = true;
    constructor(readonly config: Record<string, unknown>) {
      FakeHls.instances.push(this);
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }
    off(event: string, handler: Handler) {
      this.handlers.set(event, (this.handlers.get(event) ?? []).filter((each) => each !== handler));
    }
    emit(event: string, data: unknown) {
      for (const handler of this.handlers.get(event) ?? []) handler(event, data);
    }
    loadSource(url: string) {
      this.url = url;
    }
    attachMedia() {}
    destroy() {}
  }
  return FakeHls;
});
vi.mock("hls.js", () => ({ default: FakeHls }));

function aheadSeconds(policy: ReturnType<typeof bufferPolicy>, bitsPerSecond: number): number {
  return Math.min(Math.max((8 * policy.maxBufferSize) / bitsPerSecond, policy.maxBufferLength), policy.maxMaxBufferLength);
}

describe("bufferPolicy", () => {
  it("lets a screen that watches alone take a good part of the film in, as it always did", () => {
    expect(bufferPolicy(false)).toEqual({ maxBufferLength: 120, maxMaxBufferLength: 600, maxBufferSize: 128 * 1024 * 1024, backBufferLength: BACK_BUFFER_S.full });
    expect(aheadSeconds(bufferPolicy(false), 4_000_000)).toBeGreaterThan(250);
  });

  it("limits buffer size when streaming through the proxy to prevent server bandwidth spikes", () => {
    expect(bufferPolicy(false, true)).toEqual({ maxBufferLength: 30, maxMaxBufferLength: LONE_PROXY_BUFFER_AHEAD_S, maxBufferSize: LONE_PROXY_BUFFER_BYTES, backBufferLength: BACK_BUFFER_S.full });
    expect(aheadSeconds(bufferPolicy(false, true), 4_000_000)).toBe(LONE_PROXY_BUFFER_AHEAD_S);
  });

  it("keeps a weak device's memory small, behind the picture too, and is never looser than the party or the proxy", () => {
    for (const [inParty, proxied] of [[false, false], [false, true], [true, false], [true, true]] as const) {
      const lite = bufferPolicy(inParty, proxied, "lite");
      const full = bufferPolicy(inParty, proxied);
      expect(lite.maxBufferLength).toBeLessThanOrEqual(Math.min(full.maxBufferLength, LITE_BUFFER.maxBufferLength));
      expect(lite.maxMaxBufferLength).toBeLessThanOrEqual(Math.min(full.maxMaxBufferLength, LITE_BUFFER.maxMaxBufferLength));
      expect(lite.maxBufferSize).toBeLessThanOrEqual(Math.min(full.maxBufferSize, LITE_BUFFER.maxBufferSize));
      expect(lite.backBufferLength).toBe(BACK_BUFFER_S.lite);
      expect(full.backBufferLength).toBe(BACK_BUFFER_S.full);
    }
    expect(bufferPolicy(true, false, "lite")).toMatchObject({ maxBufferLength: 10, maxMaxBufferLength: PARTY_BUFFER_AHEAD_S, maxBufferSize: PARTY_BUFFER_BYTES });
    expect(Number.isFinite(BACK_BUFFER_S.full) && BACK_BUFFER_S.lite < BACK_BUFFER_S.full).toBe(true);
  });

  it("keeps the subtitles a delay shows: behind the picture for a late one, ahead for an early one, on any device", () => {
    for (const tier of ["full", "lite"] as const)
      for (const [inParty, proxied] of [[false, false], [false, true], [true, false]] as const) {
        const plain = bufferPolicy(inParty, proxied, tier);
        const late = bufferPolicy(inParty, proxied, tier, 60);
        const early = bufferPolicy(inParty, proxied, tier, -60);
        expect(late.backBufferLength).toBeGreaterThanOrEqual(60 + DELAY_REACH_S);
        expect(late.maxBufferLength).toBe(plain.maxBufferLength);
        expect(early.maxBufferLength).toBeGreaterThanOrEqual(60 + DELAY_REACH_S);
        expect(early.maxMaxBufferLength).toBeGreaterThanOrEqual(early.maxBufferLength);
        expect(early.backBufferLength).toBe(plain.backBufferLength);
        expect(bufferPolicy(inParty, proxied, tier, 5)).toEqual({ ...plain, backBufferLength: Math.max(plain.backBufferLength, 5 + DELAY_REACH_S) });
      }
  });

  it("keeps the screens of a party within 40 seconds and 32 MiB of their picture, at any usual bitrate", () => {
    for (const mbit of [0.5, 1, 2, 4, 6, 8, 12, 16]) {
      const bitsPerSecond = mbit * 1_000_000;
      const seconds = aheadSeconds(bufferPolicy(true), bitsPerSecond);
      expect(seconds, `${mbit} Mbit/s`).toBeLessThanOrEqual(PARTY_BUFFER_AHEAD_S);
      expect((seconds * bitsPerSecond) / 8, `${mbit} Mbit/s`).toBeLessThanOrEqual(PARTY_BUFFER_BYTES + 1);
    }
  });

  it("still looks ahead in a party, to ride out a bad moment on the way", () => {
    expect(aheadSeconds(bufferPolicy(true), 4_000_000)).toBe(PARTY_BUFFER_AHEAD_S);
    expect(aheadSeconds(bufferPolicy(true), 16_000_000)).toBeGreaterThan(10);
  });
});

describe("proxiedQualityCap", () => {
  const ladder = (...sizes: Array<[number, number]>) => sizes.map(([width, height]) => ({ width, height }));

  it("stops at 720p, the best level that is not high definition", () => {
    expect(proxiedQualityCap(ladder([426, 240], [640, 360], [854, 480], [1280, 720], [1920, 1080]))).toBe(3);
    expect(proxiedQualityCap(ladder([640, 360], [1280, 720], [1920, 1080], [3840, 2160]))).toBe(1);
  });

  it("goes by the shape of a film, not by its height alone: 1280x536 is 720p and 1920x804 is 1080p", () => {
    expect(proxiedQualityCap(ladder([854, 358], [1280, 536], [1920, 804]))).toBe(1);
  });

  it("has nothing to cap when there is one level, or none above 720p, or the sizes are not told", () => {
    expect(proxiedQualityCap(ladder([1920, 1080]))).toBe(-1);
    expect(proxiedQualityCap(ladder([640, 360], [1280, 720]))).toBe(-1);
    expect(proxiedQualityCap([])).toBe(-1);
    expect(proxiedQualityCap([{}, {}])).toBe(-1);
  });

  it("keeps the lowest level when every one of them is high definition", () => {
    expect(proxiedQualityCap(ladder([1920, 1080], [3840, 2160]))).toBe(0);
  });
});

class FakeVideo extends EventTarget {
  src = "";
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  playbackRate = 1;
  readyState = 0;
  seeking = false;
  buffered = { length: 0, start: () => 0, end: () => 0 };
  firstChild = null;
  textTracks = undefined;
  pause() {}
  load() {}
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  canPlayType() {
    return "maybe";
  }
}
const newEngine = () => {
  const video = new FakeVideo();
  const states: Array<{ state: string; error?: string }> = [];
  const engine = new PlayerEngine(video as unknown as HTMLVideoElement, (state) => states.push(state));
  return { video, engine, states };
};
const stubBrowser = () => {
  vi.stubGlobal("location", { href: "http://kino.test/tv" });
  vi.stubGlobal("HTMLMediaElement", { HAVE_FUTURE_DATA: 3 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
};

describe("a picture that comes through this server", () => {
  const levels = [
    { width: 640, height: 360 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ];
  const PROXIED = "/api/proxy?url=https%3A%2F%2Fcdn.example%2Fa.m3u8";
  beforeEach(() => {
    FakeHls.instances.length = 0;
    FakeHls.supported = true;
    stubBrowser();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const parsed = async (url: string, before?: (engine: PlayerEngine) => void) => {
    const { engine } = newEngine();
    before?.(engine);
    await engine.load(url, "hls");
    const hls = FakeHls.instances.at(-1)!;
    hls.emit("manifestParsed", { levels });
    engine.destroy();
    return hls;
  };

  it("notes where the load's time went: the list of qualities, then the first piece of picture (its length, size and height), not the sound's", async () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { engine } = newEngine();
    await engine.load(PROXIED, "hls", undefined, 600);
    const hls = Object.assign(FakeHls.instances.at(-1)!, { levels });
    now = 1310;
    hls.emit("manifestParsed", { levels });
    now = 1500;
    hls.emit("fragLoaded", { frag: { type: "audio", duration: 4, level: 0, stats: { loaded: 99_000 } } });
    now = 2220;
    hls.emit("fragLoaded", { frag: { type: "main", duration: 6.02, level: 0, stats: { loaded: 860_160 } } });
    now = 3000;
    hls.emit("fragLoaded", { frag: { type: "main", duration: 6, level: 2, stats: { loaded: 4_000_000 } } });
    expect(engine.startup()).toEqual({ resumed: true, manifestMs: 310, pieceMs: 1220, pieceS: 6, pieceKB: 840, height: 360 });
    await engine.load(PROXIED, "hls");
    expect(engine.startup()).toEqual({});
    engine.destroy();
  });

  it("leaves the player's own choice of quality to stop at 720p", async () => {
    expect((await parsed(PROXIED)).autoLevelCapping).toBe(1);
  });

  it("leaves a picture that does not come through the server alone, at any quality", async () => {
    expect((await parsed("https://cdn.example/a.m3u8")).autoLevelCapping).toBe(-1);
  });

  it("is not the business of a profile that asked for the best quality there is", async () => {
    const hls = await parsed(PROXIED, (engine) => engine.setAdaptive(false));
    expect(hls.autoLevelCapping).toBe(-1);
    expect(hls.currentLevel).toBe(2);
  });

  it.each(["https://cdn.example/a.m3u8", "https://relay.example/api/proxy?url=film"])("does not redirect a failed external stream through the website: %s", async (url) => {
    const { engine } = newEngine();
    await engine.load(url, "hls");
    const hls = FakeHls.instances.at(-1)!;
    hls.emit("manifestParsed", { levels });
    expect(hls.autoLevelCapping).toBe(-1);
    hls.emit("error", { type: "networkError", details: "manifestLoadError", fatal: true });
    expect(hls.url).toBe(url);
    engine.destroy();
  });
});

describe("the first piece of a film with Auto off", () => {
  const levels = [
    { width: 640, height: 360, bitrate: 700_000 },
    { width: 854, height: 480, bitrate: 1_200_000 },
    { width: 1280, height: 720, bitrate: 2_800_000 },
    { width: 1920, height: 1080, bitrate: 5_000_000 },
  ];
  beforeEach(() => {
    FakeHls.instances.length = 0;
    FakeHls.supported = true;
    stubBrowser();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const pieces = (...seconds: number[]) => {
    let start = 0;
    return seconds.map((duration) => ({ start: (start += duration) - duration, duration }));
  };
  const started = async (startAt?: number, adaptive = false) => {
    const { engine } = newEngine();
    engine.setAdaptive(adaptive);
    await engine.load("https://cdn.example/a.m3u8", "hls", undefined, startAt);
    const hls = Object.assign(FakeHls.instances.at(-1)!, { levels });
    hls.emit("manifestParsed", { levels });
    return { engine, hls };
  };
  const main = (level: number) => ({ frag: { type: "main", duration: 2, level, stats: { loaded: 400_000 } } });
  const current = (engine: PlayerEngine) => (engine as unknown as { getQualityState(): { current: number } | undefined }).getQualityState()?.current;

  const highestList = (hls: InstanceType<typeof FakeHls>, ...seconds: number[]) => hls.emit("levelUpdated", { level: 3, details: { fragments: pieces(...seconds) } });

  it("asks for the highest's list first, as before; the first piece then comes in 480p, and every piece after it in the highest", async () => {
    const { engine, hls } = await started();
    expect(hls.currentLevel).toBe(3);
    expect(hls.loadLevelWrites).toEqual([]);
    highestList(hls, 2, 2, 2);
    expect(hls.loadLevelWrites).toEqual([1]);
    expect(current(engine)).toBe(3);
    hls.emit("levelUpdated", { level: 1, details: { fragments: pieces(2, 2, 2) } });
    hls.emit("fragLoaded", { frag: { type: "audio", level: 1, duration: 2, stats: { loaded: 30_000 } } });
    expect(hls.loadLevelWrites).toEqual([1]);
    hls.emit("fragLoaded", main(1));
    expect(hls.loadLevelWrites).toEqual([1, 3]);
    hls.emit("fragLoaded", main(3));
    highestList(hls, 2, 2);
    expect(hls.loadLevelWrites).toEqual([1, 3]);
    expect(current(engine)).toBe(3);
    engine.destroy();
  });

  it("takes pieces of up to 6 seconds that way, as hosts cut them (6.006, 6.2); a film cut into longer ones starts in the highest, request for request as before", async () => {
    for (const seconds of [5.005, 6, 6.006, 6.2]) {
      const short = await started();
      highestList(short.hls, seconds, seconds);
      expect([seconds, short.hls.loadLevelWrites]).toEqual([seconds, [1]]);
      short.engine.destroy();
    }
    for (const seconds of [6.4, 10]) {
      const long = await started();
      highestList(long.hls, seconds, seconds, seconds);
      long.hls.emit("fragLoaded", main(3));
      highestList(long.hls, 2, 2);
      expect([seconds, long.hls.loadLevelWrites]).toEqual([seconds, []]);
      long.engine.destroy();
    }
  });

  it("goes by the piece a resume starts in", async () => {
    const short = await started(3);
    highestList(short.hls, 4, 10, 4);
    expect(short.hls.loadLevelWrites).toEqual([1]);
    short.engine.destroy();
    const long = await started(5);
    highestList(long.hls, 4, 10, 4);
    expect(long.hls.loadLevelWrites).toEqual([]);
    long.engine.destroy();
  });

  it("is not done with Auto on: hls.js starts in the lowest there is itself", async () => {
    const { engine, hls } = await started(undefined, true);
    expect(hls.currentLevel).toBe(-1);
    highestList(hls, 2, 2);
    hls.emit("fragLoaded", main(1));
    expect(hls.loadLevelWrites).toEqual([]);
    engine.destroy();
  });

  it("gives way to a quality picked while the first piece comes in, and to going back to Auto when 480p does not load", async () => {
    const pick = await started();
    highestList(pick.hls, 2, 2);
    pick.engine.setQuality(2);
    pick.hls.emit("fragLoaded", main(1));
    expect(pick.hls.loadLevelWrites).toEqual([1]);
    pick.engine.destroy();
    const refused = await started();
    highestList(refused.hls, 2, 2);
    for (let each = 0; each < QUALITY_GIVE_UPS; each++) refused.hls.emit("error", { type: "networkError", details: "fragLoadError", fatal: false, errorAction: { action: 2 } });
    expect(refused.hls.loadLevelWrites).toEqual([1, -1]);
    refused.hls.emit("fragLoaded", main(1));
    expect(refused.hls.loadLevelWrites).toEqual([1, -1]);
    refused.engine.destroy();
  });

  it("goes back to the highest at once when the 480p list or piece does not come, whatever hls.js would try next; an error elsewhere is not it", async () => {
    const list = await started();
    highestList(list.hls, 2, 2);
    list.hls.emit("error", { type: "networkError", details: "fragLoadError", fatal: false, frag: { type: "audio", level: 1 }, errorAction: { action: 5 } });
    list.hls.emit("error", { type: "networkError", details: "audioTrackLoadError", fatal: false, context: { type: "audioTrack", level: 1 }, errorAction: { action: 5 } });
    list.hls.emit("error", { type: "networkError", details: "levelLoadError", fatal: false, context: { type: "level", level: 2 }, errorAction: { action: 5 } });
    expect(list.hls.loadLevelWrites).toEqual([1]);
    list.hls.emit("error", { type: "networkError", details: "levelLoadError", fatal: false, context: { type: "level", level: 1 }, errorAction: { action: 5 } });
    expect(list.hls.loadLevelWrites).toEqual([1, 3]);
    list.hls.emit("fragLoaded", main(1));
    expect(list.hls.loadLevelWrites).toEqual([1, 3]);
    list.engine.destroy();
    const piece = await started();
    highestList(piece.hls, 2, 2);
    piece.hls.emit("error", { type: "networkError", details: "fragLoadTimeOut", fatal: false, frag: { type: "main", level: 1 }, errorAction: { action: 5 } });
    expect(piece.hls.loadLevelWrites).toEqual([1, 3]);
    piece.engine.destroy();
    const before = await started();
    before.hls.emit("error", { type: "networkError", details: "levelLoadError", fatal: false, context: { type: "level", level: 1 }, errorAction: { action: 5 } });
    expect(before.hls.loadLevelWrites).toEqual([]);
    before.engine.destroy();
  });

  it("ends with the film: the next one starts afresh", async () => {
    const { engine, hls } = await started();
    highestList(hls, 2, 2);
    engine.setAdaptive(true);
    await engine.load("https://cdn.example/b.m3u8", "hls");
    const next = Object.assign(FakeHls.instances.at(-1)!, { levels });
    next.emit("manifestParsed", { levels });
    highestList(next, 2, 2);
    next.emit("fragLoaded", main(1));
    expect(next.loadLevelWrites).toEqual([]);
    expect(hls.loadLevelWrites).toEqual([1]);
    engine.destroy();
  });
});

describe("lowFirstLevel", () => {
  const size = (width: number, height: number, bitrate?: number) => ({ width, height, ...(bitrate ? { bitrate } : {}) });

  it("is the 480p one, as the menu names it (by the film's shape too), the better of two", () => {
    expect(lowFirstLevel([size(1920, 1080), size(1280, 720), size(854, 480), size(640, 360)], 0)).toBe(2);
    expect(lowFirstLevel([size(640, 360), size(854, 356), size(1280, 536)], 2)).toBe(1);
    expect(lowFirstLevel([size(854, 480, 900), size(854, 480, 1500), size(1280, 720)], 2)).toBe(1);
    expect(lowFirstLevel([{ height: 480 }, { height: 1080 }], 1)).toBe(0);
  });

  it("is of the highest's kind of picture only (its codecs and its range), as hls.js's own Auto keeps to", () => {
    const hevcTop = [{ ...size(854, 480), codecSet: "avc1,mp4a" }, { ...size(854, 480), codecSet: "hvc1,mp4a" }, { ...size(1920, 1080), codecSet: "hvc1,mp4a" }];
    expect(lowFirstLevel(hevcTop, 2)).toBe(1);
    expect(lowFirstLevel([{ ...size(854, 480), codecSet: "avc1,mp4a" }, { ...size(1920, 1080), codecSet: "hvc1,mp4a" }], 1)).toBe(-1);
    expect(lowFirstLevel([{ ...size(854, 480), videoRange: "SDR" }, { ...size(3840, 2160), videoRange: "PQ" }], 1)).toBe(-1);
    expect(lowFirstLevel([{ ...size(854, 480), videoRange: "PQ" }, { ...size(3840, 2160), videoRange: "PQ" }], 1)).toBe(0);
  });

  it("is none for a film whose best is under 720p, with no 480p (not 360p or 180p instead), or with its sizes not told", () => {
    expect(lowFirstLevel([size(640, 360), size(854, 480)], 1)).toBe(-1);
    expect(lowFirstLevel([size(640, 360), size(1280, 720), size(1920, 1080)], 2)).toBe(-1);
    expect(lowFirstLevel([size(320, 180), size(1280, 720)], 1)).toBe(-1);
    expect(lowFirstLevel([{}, {}, { height: 1080 }], 2)).toBe(-1);
    expect(lowFirstLevel([size(1920, 1080)], 0)).toBe(-1);
    expect(lowFirstLevel([], 0)).toBe(-1);
  });
});

describe("a quality picked by hand", () => {
  const levels = [
    { width: 640, height: 360 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ];
  beforeEach(() => {
    FakeHls.instances.length = 0;
    FakeHls.supported = true;
    stubBrowser();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const picked = async () => {
    const { engine } = newEngine();
    await engine.load("https://cdn.example/a.m3u8", "hls");
    const hls = FakeHls.instances.at(-1)!;
    hls.emit("manifestParsed", { levels });
    hls.manualLevel = 2;
    return { engine, hls };
  };
  const leave = (hls: InstanceType<typeof FakeHls>, action = 2) => hls.emit("error", { type: "networkError", details: "fragLoadError", fatal: false, errorAction: { action } });

  it("is asked of hls.js to be kept when a piece will not load, where it would go back to Auto at the first one", async () => {
    const { engine, hls } = await picked();
    expect(hls.config.preserveManualLevelOnError).toBe(true);
    engine.destroy();
  });

  it("stays through a piece that was refused, and through a few of them as long as pieces arrive between", async () => {
    const { engine, hls } = await picked();
    for (let round = 0; round < 4; round++) {
      leave(hls);
      leave(hls);
      hls.emit("fragLoaded", {});
    }
    expect(hls.manualLevel).toBe(2);
    expect(hls.loadLevelWrites).toEqual([]);
    engine.destroy();
  });

  it("goes back to Auto when the quality does not load: that many answers in a row, with no piece between", async () => {
    const { engine, hls } = await picked();
    for (let each = 1; each < QUALITY_GIVE_UPS; each++) leave(hls);
    expect(hls.manualLevel).toBe(2);
    leave(hls);
    expect(hls.manualLevel).toBe(-1);
    expect(hls.loadLevelWrites).toEqual([-1]);
    engine.destroy();
  });

  it("is not given up on for the tries hls.js makes on its own, or for an error that ends the film instead", async () => {
    const { engine, hls } = await picked();
    for (let each = 0; each < QUALITY_GIVE_UPS * 2; each++) leave(hls, 5);
    for (let each = 0; each < QUALITY_GIVE_UPS; each++) hls.emit("error", { type: "networkError", details: "manifestLoadError", fatal: true, errorAction: { action: 2 } });
    expect(hls.manualLevel).toBe(2);
    expect(hls.loadLevelWrites).toEqual([]);
    engine.destroy();
  });

  it("leaves the player's own choice alone: nothing is written to the level when it was never picked", async () => {
    const { engine, hls } = await picked();
    hls.manualLevel = -1;
    for (let each = 0; each < QUALITY_GIVE_UPS * 2; each++) leave(hls);
    expect(hls.loadLevelWrites).toEqual([]);
    engine.destroy();
  });

  it("counts again from nothing after it has gone back, and after a new pick", async () => {
    const { engine, hls } = await picked();
    for (let each = 0; each < QUALITY_GIVE_UPS; each++) leave(hls);
    expect(hls.manualLevel).toBe(-1);
    hls.manualLevel = 2;
    for (let each = 1; each < QUALITY_GIVE_UPS; each++) leave(hls);
    expect(hls.manualLevel).toBe(2);
    engine.destroy();
  });
});

describe("a direct address that the browser plays itself", () => {
  const PROXIED = "http://kino.test/api/proxy?url=https%3A%2F%2Fcdn.example%2Fa.m3u8";
  const DIRECT = "https://cdn.example/a.m3u8";
  beforeEach(() => {
    FakeHls.supported = false;
    vi.useFakeTimers();
    stubBrowser();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the relay from the start, including native HLS, even when a raw address was provided", async () => {
    const { video, engine } = newEngine();
    const relay = "https://relay.example/api/proxy?url=film";
    await engine.load(relay, "hls", undefined, undefined, DIRECT);
    expect(video.src).toBe(relay);
    video.dispatchEvent(new Event("error"));
    vi.advanceTimersByTime(DIRECT_START_MS * 2);
    expect(video.src).toBe(relay);
    engine.destroy();
  });

  it("goes first, with the server's own address to fall back to when the browser says no", async () => {
    const { video, engine } = newEngine();
    await engine.load(PROXIED, "hls", undefined, undefined, DIRECT);
    expect(video.src).toBe(DIRECT);
    video.dispatchEvent(new Event("error"));
    expect(video.src).toBe(PROXIED);
    engine.destroy();
  });

  it("gives way to the server's own address when it does not answer at all", async () => {
    const { video, engine } = newEngine();
    await engine.load(PROXIED, "hls", undefined, undefined, DIRECT);
    vi.advanceTimersByTime(DIRECT_START_MS - 1);
    expect(video.src).toBe(DIRECT);
    vi.advanceTimersByTime(1);
    expect(video.src).toBe(PROXIED);
    engine.destroy();
  });

  it("is kept once it has begun to play", async () => {
    const { video, engine } = newEngine();
    await engine.load(PROXIED, "hls", undefined, undefined, DIRECT);
    video.readyState = 1;
    video.dispatchEvent(new Event("loadedmetadata"));
    vi.advanceTimersByTime(DIRECT_START_MS * 3);
    expect(video.src).toBe(DIRECT);
    engine.destroy();
  });

  it("is forgotten with the picture it was for", async () => {
    const { video, engine } = newEngine();
    await engine.load(PROXIED, "hls", undefined, undefined, DIRECT);
    await engine.load("http://kino.test/api/proxy?url=other", "hls");
    vi.advanceTimersByTime(DIRECT_START_MS * 3);
    expect(video.src).toBe("http://kino.test/api/proxy?url=other");
    engine.destroy();
  });

  it("is the same for a plain file", async () => {
    const { video, engine } = newEngine();
    await engine.load("http://kino.test/api/proxy?url=https%3A%2F%2Fcdn.example%2Fa.mp4", "mp4", undefined, undefined, "https://cdn.example/a.mp4");
    expect(video.src).toBe("https://cdn.example/a.mp4");
    vi.advanceTimersByTime(DIRECT_START_MS);
    expect(video.src).toBe("http://kino.test/api/proxy?url=https%3A%2F%2Fcdn.example%2Fa.mp4");
    engine.destroy();
  });

  it("fails for good when the server's own address does not play either", async () => {
    const { video, engine, states } = newEngine();
    await engine.load(PROXIED, "hls", undefined, undefined, DIRECT);
    video.dispatchEvent(new Event("error"));
    expect(states.at(-1)?.state).not.toBe("error");
    video.dispatchEvent(new Event("error"));
    expect(states.at(-1)).toMatchObject({ state: "error", error: "SOURCE_NOT_DIRECTLY_PLAYABLE" });
    engine.destroy();
  });
});

describe("a file that will not open", () => {
  beforeEach(() => stubBrowser());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const RELAYED = "https://relay.example/api/proxy?url=https%3A%2F%2Fcdn.example%2Fa.mp4&expires=1&sig=abc";
  const willNotOpen = (video: FakeVideo) => {
    (video as unknown as { error: { code: number } }).error = { code: 4 };
    video.dispatchEvent(new Event("error"));
  };

  it("through a proxy of ours, before anything of it came, is a source that said no: it is looked up afresh, and the card says the source is not answering", async () => {
    const { video, engine, states } = newEngine();
    await engine.load(RELAYED, "mp4");
    willNotOpen(video);
    expect(states.at(-1)).toMatchObject({ state: "error", error: "SOURCE_UNAVAILABLE" });
    engine.destroy();
  });

  it("from anywhere else, or once it had begun, is still a video that can't be played", async () => {
    const elsewhere = newEngine();
    await elsewhere.engine.load("https://cdn.example/a.mp4", "mp4");
    willNotOpen(elsewhere.video);
    expect(elsewhere.states.at(-1)).toMatchObject({ state: "error", error: "SOURCE_NOT_DIRECTLY_PLAYABLE" });
    elsewhere.engine.destroy();

    const begun = newEngine();
    await begun.engine.load(RELAYED, "mp4");
    begun.video.dispatchEvent(new Event("loadedmetadata"));
    willNotOpen(begun.video);
    expect(begun.states.at(-1)).toMatchObject({ state: "error", error: "SOURCE_NOT_DIRECTLY_PLAYABLE" });
    begun.engine.destroy();
  });
});

describe("a start asked for past the end (a friend's message, a link typed by hand)", () => {
  beforeEach(() => {
    FakeHls.instances.length = 0;
    FakeHls.supported = true;
    stubBrowser();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const known = (video: FakeVideo, duration: number) => {
    (video as unknown as { duration: number }).duration = duration;
    video.dispatchEvent(new Event("loadedmetadata"));
  };

  it("starts a file from the beginning, not at its end where it would count as watched; a start inside it is kept", async () => {
    const { video, engine } = newEngine();
    await engine.load("https://cdn.example/a.mp4", "mp4", undefined, 86_400);
    known(video, 6_000);
    expect(video.currentTime).toBe(0);
    await engine.load("https://cdn.example/b.mp4", "mp4", undefined, 5_950);
    known(video, 6_000);
    expect(video.currentTime).toBe(0);
    await engine.load("https://cdn.example/c.mp4", "mp4", undefined, 754);
    known(video, 6_000);
    expect(video.currentTime).toBe(754);
    engine.destroy();
  });

  it("takes hls.js back to the beginning when the start it was given is the end, and leaves one inside the film where hls.js put it", async () => {
    const { video, engine } = newEngine();
    await engine.load("https://cdn.example/a.m3u8", "hls", undefined, 86_400);
    video.currentTime = 5_999;
    known(video, 6_000);
    expect(video.currentTime).toBe(0);
    await engine.load("https://cdn.example/b.m3u8", "hls", undefined, 754);
    video.currentTime = 754;
    known(video, 6_000);
    expect(video.currentTime).toBe(754);
    video.currentTime = 4_000;
    known(video, 6_000);
    expect(video.currentTime).toBe(4_000);
    engine.destroy();
  });
});

describe("the subtitle aligner", () => {
  const HLS = "https://cdn.example/a.m3u8";
  beforeEach(() => {
    FakeHls.instances.length = 0;
    FakeHls.supported = true;
    stubBrowser();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const fakeAligner = () => {
    const films: SyncFilm[] = [];
    const handles: Array<{ close: ReturnType<typeof vi.fn> }> = [];
    const addressWhenStarted: Array<string | null> = [];
    const starter: SyncStarter = (film) => {
      films.push(film);
      addressWhenStarted.push((film.hls as unknown as { url: string | null }).url);
      const handle = { close: vi.fn() };
      handles.push(handle);
      return handle;
    };
    const loader = vi.fn(() => Promise.resolve(starter));
    return { films, handles, addressWhenStarted, loader };
  };
  const known = (video: FakeVideo) => void video.dispatchEvent(new Event("loadedmetadata"));
  const started = (aligner: ReturnType<typeof fakeAligner>, count = 1) => vi.waitFor(() => expect(aligner.films).toHaveLength(count));
  const withTracks = (video: FakeVideo, tracks: Array<{ label: string; language: string; mode: string }>) => {
    (video as unknown as { textTracks: unknown }).textTracks = tracks;
    return tracks;
  };

  it("says nothing of an aligner on a TV that has none", async () => {
    const { video, engine } = newEngine();
    await engine.load(HLS, "hls");
    known(video);
    expect("subtitleSync" in engine.getState()).toBe(false);
    engine.destroy();
  });

  it("starts along with hls.js, and says how it is going", async () => {
    const { video, engine } = newEngine();
    const aligner = fakeAligner();
    engine.useSubtitleSync(aligner.loader);
    await engine.load(HLS, "hls");
    known(video);
    await started(aligner);
    expect(aligner.films[0]!.hls).toBe(FakeHls.instances.at(-1));
    expect(aligner.films[0]!.events).toEqual({ audioSwitching: "audioTrackSwitching" });
    expect(aligner.films[0]!.tap).toBeInstanceOf(AudioTap);
    expect(FakeHls.instances.at(-1)!.url).toBe(HLS);
    expect(engine.getState().subtitleSync).toBe("ready");
    aligner.films[0]!.report("syncing");
    expect(engine.getState().subtitleSync).toBe("syncing");
    aligner.films[0]!.report("synced");
    expect(engine.getState().subtitleSync).toBe("synced");
    expect("subtitleShift" in engine.getState()).toBe(false);
    aligner.films[0]!.report("synced", -2.4);
    expect(engine.getState()).toMatchObject({ subtitleSync: "synced", subtitleShift: -2.4 });
    aligner.films[0]!.report("syncing", -2.4);
    expect("subtitleShift" in engine.getState()).toBe(false);
    engine.destroy();
  });

  it("listens to the sound from the first piece, before its code has arrived, and hands what it heard to it", async () => {
    const { video, engine } = newEngine();
    const aligner = fakeAligner();
    let arrive: () => void = () => {};
    const arrived = new Promise<void>((resolve) => (arrive = resolve));
    engine.useSubtitleSync(() => arrived.then(() => aligner.loader()));
    await engine.load(HLS, "hls");
    known(video);
    const hls = FakeHls.instances.at(-1)!;
    expect(hls.url).toBe(HLS);
    expect(aligner.films).toHaveLength(0);
    const init = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);
    const media = Uint8Array.from([0, 0, 0, 16, 0x6d, 0x6f, 0x6f, 0x66, 1]);
    hls.emit("bufferAppending", { type: "audio", data: init, frag: { start: 0, duration: 4 } });
    hls.emit("bufferAppending", { type: "audio", data: media, frag: { start: 0, duration: 4 } });
    arrive();
    await started(aligner);
    const heard: number[] = [];
    aligner.films[0]!.tap.connect((piece) => heard.push(piece.start));
    expect(heard).toEqual([0]);
    hls.emit("bufferAppending", { type: "audio", data: media, frag: { start: 4, duration: 4 } });
    expect(heard).toEqual([0, 4]);
    engine.destroy();
  });

  it("still has the init segments of the sound when the viewer turns the aligner on in the middle of a film", async () => {
    const { video, engine } = newEngine();
    const aligner = fakeAligner();
    engine.useSubtitleSync(aligner.loader);
    engine.setSubtitleSync(false);
    await engine.load(HLS, "hls");
    known(video);
    const hls = FakeHls.instances.at(-1)!;
    hls.emit("bufferAppending", { type: "audio", data: Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]), frag: { start: 0, duration: 4 } });
    engine.setSubtitleSync(true);
    await started(aligner);
    const heard: number[] = [];
    aligner.films[0]!.tap.connect((piece) => heard.push(piece.start));
    hls.emit("bufferAppending", { type: "audio", data: Uint8Array.from([0, 0, 0, 16, 0x6d, 0x6f, 0x6f, 0x66, 1]), frag: { start: 400, duration: 4 } });
    expect(heard).toEqual([400]);
    engine.destroy();
  });

  it("is not even fetched for a viewer who turned it off", async () => {
    const { video, engine } = newEngine();
    const aligner = fakeAligner();
    engine.useSubtitleSync(aligner.loader);
    engine.setSubtitleSync(false);
    await engine.load(HLS, "hls");
    known(video);
    expect(aligner.loader).not.toHaveBeenCalled();
    expect(engine.getState().subtitleSync).toBe("off");
    engine.destroy();
  });

  it("puts the lines back when it is switched off, and starts again, for what is still to come, when it is switched on", async () => {
    const { video, engine } = newEngine();
    const aligner = fakeAligner();
    engine.useSubtitleSync(aligner.loader);
    await engine.load(HLS, "hls");
    known(video);
    await started(aligner);
    aligner.films[0]!.report("synced");
    engine.setSubtitleSync(false);
    expect(aligner.handles[0]!.close).toHaveBeenCalledWith(true);
    expect(engine.getState().subtitleSync).toBe("off");
    aligner.films[0]!.report("syncing");
    expect(engine.getState().subtitleSync).toBe("off");
    engine.setSubtitleSync(true);
    await started(aligner, 2);
    expect(aligner.films[1]!.hls).toBe(aligner.films[0]!.hls);
    expect(aligner.films[1]!.tap).toBe(aligner.films[0]!.tap);
    expect(engine.getState().subtitleSync).toBe("ready");
    engine.destroy();
  });

  it("does nothing when it is switched to what it already is", async () => {
    const { video, engine } = newEngine();
    const aligner = fakeAligner();
    engine.useSubtitleSync(aligner.loader);
    await engine.load(HLS, "hls");
    known(video);
    await started(aligner);
    engine.setSubtitleSync(true);
    await Promise.resolve();
    expect(aligner.films).toHaveLength(1);
    expect(aligner.handles[0]!.close).not.toHaveBeenCalled();
    engine.destroy();
  });

  it("goes with the film it was for, and nothing a closed one says is heard", async () => {
    const { video, engine } = newEngine();
    const aligner = fakeAligner();
    engine.useSubtitleSync(aligner.loader);
    await engine.load(HLS, "hls");
    known(video);
    await started(aligner);
    const first = aligner.films[0]!;
    await engine.load("https://cdn.example/b.m3u8", "hls");
    known(video);
    expect(aligner.handles[0]!.close).toHaveBeenCalledWith();
    await started(aligner, 2);
    first.report("synced");
    first.show(0);
    expect(engine.getState().subtitleSync).toBe("ready");
    expect(engine.quiet()).toBe(false);
    engine.destroy();
    expect(aligner.handles[1]!.close).toHaveBeenCalled();
  });

  it("has none for a picture the browser's own player plays: it gives no access to the sound", async () => {
    const aligner = fakeAligner();
    for (const play of [
      async (engine: PlayerEngine) => engine.load("https://cdn.example/a.mp4", "mp4"),
      async (engine: PlayerEngine) => {
        FakeHls.supported = false;
        await engine.load(HLS, "hls");
      },
    ]) {
      const { video, engine } = newEngine();
      engine.useSubtitleSync(aligner.loader);
      await play(engine);
      known(video);
      expect(engine.getState().subtitleSync).toBe("unavailable");
      engine.setSubtitleSync(false);
      engine.setSubtitleSync(true);
      expect(engine.getState().subtitleSync).toBe("unavailable");
      engine.destroy();
    }
    expect(aligner.loader).not.toHaveBeenCalled();
  });

  it("plays on, without it, when it cannot be fetched or the device cannot run it", async () => {
    const offline = newEngine();
    offline.engine.useSubtitleSync(() => Promise.reject(new Error("offline")));
    await offline.engine.load(HLS, "hls");
    known(offline.video);
    expect(FakeHls.instances).toHaveLength(1);
    expect(FakeHls.instances[0]!.url).toBe(HLS);
    await vi.waitFor(() => expect(offline.engine.getState().subtitleSync).toBe("unavailable"));
    offline.engine.destroy();

    const unable = newEngine();
    unable.engine.useSubtitleSync(() => Promise.resolve(() => undefined));
    await unable.engine.load(HLS, "hls");
    known(unable.video);
    await vi.waitFor(() => expect(unable.engine.getState().subtitleSync).toBe("unavailable"));
    unable.engine.destroy();
  });

  it("does not hold the film back for an aligner that is slow to arrive", async () => {
    const { video, engine } = newEngine();
    engine.useSubtitleSync(() => new Promise(() => {}));
    await engine.load(HLS, "hls");
    known(video);
    expect(FakeHls.instances.at(-1)!.url).toBe(HLS);
    expect(engine.getState().subtitleSync).toBe("ready");
    engine.destroy();
  });

  it("starts nothing for a film that is gone, or a switch that was turned off, by the time its code arrives", async () => {
    const aligner = fakeAligner();
    let arrive: () => void = () => {};
    const arrived = new Promise<void>((resolve) => (arrive = resolve));
    const loader = () => arrived.then(() => aligner.loader());

    const gone = newEngine();
    gone.engine.useSubtitleSync(loader);
    await gone.engine.load(HLS, "hls");
    await gone.engine.load("https://cdn.example/b.m3u8", "mp4");
    const off = newEngine();
    off.engine.useSubtitleSync(loader);
    await off.engine.load(HLS, "hls");
    off.engine.setSubtitleSync(false);
    arrive();
    await new Promise((resolve) => setTimeout(resolve, 10));
    known(off.video);
    expect(aligner.films).toHaveLength(0);
    expect(off.engine.getState().subtitleSync).toBe("off");
    gone.engine.destroy();
    off.engine.destroy();
  });

  it("is told the viewer's own subtitle delay, as it stands now", async () => {
    const { video, engine } = newEngine();
    const aligner = fakeAligner();
    let delay = 0;
    engine.useSubtitleSync(aligner.loader, () => delay);
    await engine.load(HLS, "hls");
    known(video);
    await started(aligner);
    delay = 1.5;
    expect(aligner.films[0]!.delay?.()).toBe(1.5);
    engine.destroy();
  });

  it("puts a track on screen when it asks, and keeps the page quiet about a change nobody made", async () => {
    vi.useFakeTimers();
    const { video, engine } = newEngine();
    const tracks = withTracks(video, [
      { label: "English", language: "en", mode: "hidden" },
      { label: "Română", language: "ro", mode: "disabled" },
    ]);
    const aligner = fakeAligner();
    engine.useSubtitleSync(aligner.loader);
    await engine.load(HLS, "hls");
    known(video);
    await vi.waitFor(() => expect(aligner.films).toHaveLength(1));
    expect(engine.quiet()).toBe(false);
    aligner.films[0]!.show(1);
    expect(tracks.map((track) => track.mode)).toEqual(["disabled", "hidden"]);
    expect(engine.getState().subtitles?.current).toBe(1);
    expect(engine.quiet()).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(engine.quiet()).toBe(false);
    engine.destroy();
  });

  it("does not offer a track the aligner has only loaded to try as the one the viewer chose, and gives it up when the viewer picks", async () => {
    const { video, engine } = newEngine();
    const tracks = withTracks(video, [
      { label: "English", language: "en", mode: "hidden" },
      { label: "Română", language: "ro", mode: "hidden" },
      { label: "Français", language: "fr", mode: "disabled" },
    ]);
    hold(tracks[1]!);
    await engine.load(HLS, "hls");
    known(video);
    expect(engine.getState().subtitles?.current).toBe(0);
    engine.setSubtitle(1);
    expect(isHeld(tracks[1]!)).toBe(false);
    expect(tracks.map((track) => track.mode)).toEqual(["disabled", "hidden", "disabled"]);
    expect(engine.getState().subtitles?.current).toBe(1);
    engine.setSubtitle(-1);
    expect(engine.getState().subtitles?.current).toBe(-1);
    engine.destroy();
  });

  it("reports no track chosen while the only one that is loaded is held", async () => {
    const { video, engine } = newEngine();
    const tracks = withTracks(video, [{ label: "English", language: "en", mode: "hidden" }]);
    hold(tracks[0]!);
    await engine.load(HLS, "hls");
    known(video);
    expect(engine.getState().subtitles).toMatchObject({ current: -1 });
    engine.destroy();
  });
});

class CapturingVideo extends FakeVideo {
  crossOrigin: string | null = null;
  play() {
    return Promise.resolve();
  }
  captureStream() {
    const stream = new EventTarget() as EventTarget & { getAudioTracks(): unknown[]; getVideoTracks(): unknown[]; getTracks(): unknown[] };
    stream.getAudioTracks = () => [];
    stream.getVideoTracks = () => [];
    stream.getTracks = () => [];
    return stream;
  }
  override removeAttribute(name: string) {
    if (name === "crossorigin") this.crossOrigin = null;
    else super.removeAttribute(name);
  }
}

const stubAudio = () => {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 }, onaudioprocess: null });
  class FakeAudioContext {
    sampleRate = 48000;
    destination = {};
    createScriptProcessor() {
      return node();
    }
    createMediaStreamSource() {
      return node();
    }
    createGain() {
      return node();
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("OfflineAudioContext", class {});
};

describe("a file the browser plays by itself, and the subtitle aligner", () => {
  const RELAY = "https://relay.example/api/proxy?url=https%3A%2F%2Fcdn.example%2Fa.mp4&expires=1&sig=abc";
  beforeEach(() => {
    stubBrowser();
    stubAudio();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const aligner = () => {
    const films: SyncFilm[] = [];
    const starter: SyncStarter = (film) => {
      films.push(film);
      return { close: vi.fn() };
    };
    return { films, loader: vi.fn(() => Promise.resolve(starter)) };
  };
  const newCapturing = () => {
    const video = new CapturingVideo();
    const states: Array<{ state: string; error?: string }> = [];
    const engine = new PlayerEngine(video as unknown as HTMLVideoElement, (state) => states.push(state));
    return { video, engine, states };
  };

  it("knows which films a page may read: this site's, and the relay's", () => {
    const here = "https://kino4tv.com/tv";
    expect(readableFrom("/fixtures/a.mp4", here)).toBe("same-origin");
    expect(readableFrom("https://kino4tv.com/api/proxy?url=x", here)).toBe("same-origin");
    expect(readableFrom(RELAY, here)).toBe("cors");
    const made = signedRelayUrl("https://kino-relay.example/api/proxy", { url: "https://cdn.example/a.mp4", referer: "https://cdn.example/", expires: Date.now() + 1000, hostToken: false }, "k".repeat(32));
    expect(readableFrom(made, here)).toBe("cors");
    expect(readableFrom("https://cdn.example/a.mp4", here)).toBeUndefined();
    expect(readableFrom("https://other.example/api/proxy?url=x", here)).toBeUndefined();
  });

  it("listens to a film through the relay, which it asks for so that it can be read; the aligner is told the sound comes as it plays", async () => {
    const { video, engine } = newCapturing();
    const sync = aligner();
    engine.useSubtitleSync(sync.loader);
    await engine.load(RELAY, "mp4");
    expect(video.crossOrigin).toBe("anonymous");
    expect(video.src).toBe(RELAY);
    await vi.waitFor(() => expect(sync.films).toHaveLength(1));
    expect(sync.films[0]!.live).toBe(true);
    expect(sync.films[0]!.hls).toBeUndefined();
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(engine.getState().subtitleSync).toBe("ready");
    await engine.load("https://cdn.example/b.mp4", "mp4");
    expect(video.crossOrigin).toBeNull();
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(engine.getState().subtitleSync).toBe("unavailable");
    engine.destroy();
  });

  it("listens to a film from this site without asking for it in any other way", async () => {
    const { video, engine } = newCapturing();
    const sync = aligner();
    engine.useSubtitleSync(sync.loader);
    await engine.load("/fixtures/sample.mp4", "mp4");
    expect(video.crossOrigin).toBeNull();
    await vi.waitFor(() => expect(sync.films).toHaveLength(1));
    engine.destroy();
  });

  it("asks for nothing new without an aligner, and leaves a direct address that goes first as it was", async () => {
    const plain = newCapturing();
    await plain.engine.load(RELAY, "mp4");
    expect(plain.video.crossOrigin).toBeNull();
    plain.engine.destroy();

    const direct = newCapturing();
    const sync = aligner();
    direct.engine.useSubtitleSync(sync.loader);
    await direct.engine.load("http://kino.test/api/proxy?url=https%3A%2F%2Fcdn.example%2Fa.mp4", "mp4", undefined, undefined, "https://cdn.example/a.mp4");
    expect(direct.video.crossOrigin).toBeNull();
    expect(direct.video.src).toBe("https://cdn.example/a.mp4");
    direct.video.dispatchEvent(new Event("loadedmetadata"));
    expect(direct.engine.getState().subtitleSync).toBe("unavailable");
    expect(sync.loader).not.toHaveBeenCalled();
    direct.engine.destroy();
  });

  it("a film through the relay that will not start when asked for so is asked for again as before, once, without the aligner; the place it starts and the play wanted are kept", async () => {
    const { video, engine } = newCapturing();
    const sync = aligner();
    engine.useSubtitleSync(sync.loader);
    await engine.load(RELAY, "mp4", undefined, 120);
    engine.play();
    let asked = 0;
    const src = Object.getOwnPropertyDescriptor(video, "src")!;
    Object.defineProperty(video, "src", { get: () => src.value as string, set: (value: string) => { asked++; src.value = value; }, configurable: true });
    video.dispatchEvent(new Event("error"));
    expect(asked).toBe(1);
    expect(video.src).toBe(RELAY);
    expect(video.crossOrigin).toBeNull();
    expect(engine.getState().state).not.toBe("error");
    const play = vi.spyOn(engine, "play");
    (video as unknown as { duration: number }).duration = 600;
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.currentTime).toBe(120);
    expect(play).toHaveBeenCalled();
    expect(engine.getState().subtitleSync).toBe("unavailable");
    engine.destroy();
  });

  it("a film through the relay that fails twice is a film that fails", async () => {
    const { video, engine } = newCapturing();
    engine.useSubtitleSync(aligner().loader);
    await engine.load(RELAY, "mp4");
    video.dispatchEvent(new Event("error"));
    video.dispatchEvent(new Event("error"));
    expect(engine.getState().state).toBe("error");
    engine.destroy();
  });

  it("does not ask again for a film that had begun when it failed", async () => {
    const { video, engine } = newCapturing();
    engine.useSubtitleSync(aligner().loader);
    await engine.load(RELAY, "mp4");
    video.dispatchEvent(new Event("loadedmetadata"));
    video.readyState = 4;
    video.dispatchEvent(new Event("error"));
    expect(engine.getState().state).toBe("error");
    expect(video.crossOrigin).toBe("anonymous");
    engine.destroy();
  });
});

describe("lostTheConnection", () => {
  it("is a network error that got no answer: refused, dropped or timed out", () => {
    expect(lostTheConnection({ type: "networkError", details: "fragLoadError" })).toBe(true);
    expect(lostTheConnection({ type: "networkError", details: "fragLoadError", response: { code: 0 } })).toBe(true);
    expect(lostTheConnection({ type: "networkError", details: "manifestLoadTimeOut" })).toBe(true);
    expect(lostTheConnection({ type: "networkError", details: "fragLoadTimeOut", response: { code: 504 } })).toBe(true);
  });

  it("is not an answer that says no, nor a picture that cannot be decoded: waiting does not change those", () => {
    for (const code of [403, 404, 410, 500, 502]) {
      expect(lostTheConnection({ type: "networkError", details: "fragLoadError", response: { code } }), `${code}`).toBe(false);
    }
    expect(lostTheConnection({ type: "mediaError", details: "fragParsingError" })).toBe(false);
    expect(lostTheConnection({ type: "otherError", details: "internalException" })).toBe(false);
    expect(lostTheConnection({})).toBe(false);
  });
});

describe("a place the video comes from that says no", () => {
  beforeEach(() => {
    FakeHls.instances.length = 0;
    FakeHls.supported = true;
    stubBrowser();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const endsWith = async (data: Record<string, unknown>, address = "https://cdn.example/a.m3u8") => {
    const lines: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => void lines.push(line));
    const { engine, states } = newEngine();
    await engine.load(address, "hls");
    FakeHls.instances.at(-1)!.emit("error", { fatal: true, ...data });
    const last = states.at(-1);
    engine.destroy();
    return { last, lines };
  };

  it.each([404, 403, 410, 500, 502, 503])("is not the TV's fault when it answers HTTP %i: the card says the source, and Try again can ask for another link", async (code) => {
    const { last } = await endsWith({ type: "networkError", details: "manifestLoadError", response: { code } });
    expect(last).toMatchObject({ state: "error", error: "SOURCE_UNAVAILABLE" });
  });

  it("is still a lost connection when it does not answer at all, or when the answer is a time-out", async () => {
    expect((await endsWith({ type: "networkError", details: "manifestLoadError" })).last).toMatchObject({ error: "CONNECTION_LOST" });
    expect((await endsWith({ type: "networkError", details: "fragLoadTimeOut", response: { code: 504 } })).last).toMatchObject({ error: "CONNECTION_LOST" });
  });

  it("is still 'can't be played' for a picture that cannot be used, where nobody said no", async () => {
    expect((await endsWith({ type: "otherError", details: "internalException" })).last).toMatchObject({ error: "SOURCE_NOT_DIRECTLY_PLAYABLE" });
    expect((await endsWith({ type: "networkError", details: "manifestParsingError", response: { code: 200 } })).last).toMatchObject({ error: "SOURCE_NOT_DIRECTLY_PLAYABLE" });
  });

  it("tells a report where the answer came from, short and without the link's token", async () => {
    const relay = "https://relay.example/api/proxy?url=" + encodeURIComponent("https://videos.example/pl/SECRETTOKEN/master.m3u8") + "&sig=SIGNATURE";
    const { lines } = await endsWith({ type: "networkError", details: "manifestLoadError", url: relay, response: { code: 502 } });
    const line = lines.at(-1)!.join(" ");
    expect(line).toBe("[HLS FATAL ERROR] networkError manifestLoadError HTTP 502 from relay.example → videos.example master.m3u8");
    for (const secret of ["SECRETTOKEN", "SIGNATURE"]) expect(line, secret).not.toContain(secret);
  });

  it("is a network error with an answer of 400 or more that is not a time-out, and nothing else", () => {
    expect(sourceSaidNo({ type: "networkError", response: { code: 502 } })).toBe(true);
    expect(sourceSaidNo({ type: "networkError", details: "fragLoadTimeOut", response: { code: 502 } })).toBe(false);
    expect(sourceSaidNo({ type: "networkError", response: { code: 0 } })).toBe(false);
    expect(sourceSaidNo({ type: "mediaError", response: { code: 502 } })).toBe(false);
    expect(sourceSaidNo({})).toBe(false);
  });
});

describe("describeHlsError", () => {
  afterEach(() => vi.unstubAllGlobals());
  const relay =
    "https://relay.example/api/proxy?url=" + encodeURIComponent("https://videos.example/pl/SECRETTOKEN/master.m3u8") + "&referer=https%3A%2F%2Fembed.example%2Fplayer&expires=1&sig=SIGNATURE";

  it("says what happened, what the other end answered and from where, so a pasted console line tells a link that is gone from a connection that dropped", () => {
    expect(describeHlsError({ type: "networkError", details: "manifestLoadError", fatal: true, url: relay, response: { code: 404 } })).toBe(
      "[HLS] manifestLoadError (fatal): HTTP 404 from relay.example → videos.example master.m3u8",
    );
    expect(describeHlsError({ type: "networkError", details: "fragLoadError", url: "https://cdn.example/a/b/seg_001.m4s?token=SECRET" })).toBe("[HLS] fragLoadError: no answer from cdn.example seg_001.m4s");
    expect(describeHlsError({ type: "networkError", details: "fragLoadError", url: "https://cdn.example/seg.m4s", response: { code: 0 } })).toBe("[HLS] fragLoadError: no answer from cdn.example seg.m4s");
    expect(describeHlsError({ type: "mediaError", details: "bufferStalledError" })).toBe("[HLS] bufferStalledError");
    expect(describeHlsError({ type: "mediaError", details: "bufferAppendError", fatal: true })).toBe("[HLS] bufferAppendError (fatal)");
    expect(describeHlsError({})).toBe("[HLS] error");
  });

  it("leaves out what is a secret: the link's token and signature, the rest of its path and who it was fetched for", () => {
    const line = describeHlsError({ type: "networkError", details: "manifestLoadError", fatal: true, url: relay, response: { code: 404 } });
    for (const secret of ["SECRETTOKEN", "SIGNATURE", "embed.example", "referer", "expires"]) expect(line, secret).not.toContain(secret);
  });

  it("copes with an address of this site's own, and with one that is not an address", () => {
    vi.stubGlobal("location", { href: "http://kino.test/tv" });
    const own = "/api/proxy?url=" + encodeURIComponent("https://videos.example/x/index.m3u8");
    expect(describeHlsError({ type: "networkError", details: "levelLoadError", url: own, response: { code: 502 } })).toBe("[HLS] levelLoadError: HTTP 502 from kino.test → videos.example index.m3u8");
    expect(describeHlsError({ type: "networkError", details: "levelLoadError", url: "http://", response: { code: 500 } })).toBe("[HLS] levelLoadError: HTTP 500");
  });
});
