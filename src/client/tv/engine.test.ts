import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareBrowserStream } from "./browserStream";
import {
  DIRECT_START_MS,
  LONE_PROXY_BUFFER_AHEAD_S,
  LONE_PROXY_BUFFER_BYTES,
  PARTY_BUFFER_AHEAD_S,
  PARTY_BUFFER_BYTES,
  PlayerEngine,
  bufferPolicy,
  lostTheConnection,
  proxiedQualityCap,
} from "./engine";

/** hls.js stands in for itself: the engine's wiring to it is what is looked at, not the library. */
const FakeHls = vi.hoisted(() => {
  type Handler = (event: string, data: unknown) => void;
  class FakeHls {
    static supported = true;
    static instances: FakeHls[] = [];
    static isSupported = () => FakeHls.supported;
    static Events = { ERROR: "error", MANIFEST_PARSED: "manifestParsed", LEVEL_SWITCHED: "ls", LEVEL_LOADED: "ll", SUBTITLE_TRACK_SWITCH: "sts", SUBTITLE_TRACKS_UPDATED: "stu", AUDIO_TRACK_SWITCHED: "ats", AUDIO_TRACKS_UPDATED: "atu" };
    static ErrorTypes = { MEDIA_ERROR: "mediaError", NETWORK_ERROR: "networkError" };
    handlers = new Map<string, Handler[]>();
    url: string | null = null;
    autoLevelCapping = -1;
    currentLevel = -1;
    manualLevel = -1;
    subtitleDisplay = true;
    constructor(readonly config: Record<string, unknown>) {
      FakeHls.instances.push(this);
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
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
vi.mock("./browserStream", () => ({ prepareBrowserStream: vi.fn() }));

/** What hls.js aims at: seconds of film downloaded ahead of the picture, `max(8 * maxBufferSize / bitrate, maxBufferLength)`, never more than `maxMaxBufferLength`. */
function aheadSeconds(policy: ReturnType<typeof bufferPolicy>, bitsPerSecond: number): number {
  return Math.min(Math.max((8 * policy.maxBufferSize) / bitsPerSecond, policy.maxBufferLength), policy.maxMaxBufferLength);
}

describe("bufferPolicy", () => {
  it("lets a screen that watches alone take a good part of the film in, as it always did", () => {
    expect(bufferPolicy(false)).toEqual({ maxBufferLength: 120, maxMaxBufferLength: 600, maxBufferSize: 128 * 1024 * 1024 });
    expect(aheadSeconds(bufferPolicy(false), 4_000_000)).toBeGreaterThan(250);
  });

  it("limits buffer size when streaming through the proxy to prevent server bandwidth spikes", () => {
    expect(bufferPolicy(false, true)).toEqual({ maxBufferLength: 30, maxMaxBufferLength: LONE_PROXY_BUFFER_AHEAD_S, maxBufferSize: LONE_PROXY_BUFFER_BYTES });
    expect(aheadSeconds(bufferPolicy(false, true), 4_000_000)).toBe(LONE_PROXY_BUFFER_AHEAD_S);
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

/** Just enough of a <video> for the engine to drive. */
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

describe("an installed direct-playback extension", () => {
  beforeEach(() => {
    vi.mocked(prepareBrowserStream).mockReset();
    FakeHls.instances.length = 0;
    FakeHls.supported = true;
    stubBrowser();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("replaces the relay and server token with the viewer's direct source", async () => {
    const { engine } = newEngine();
    const direct = "https://farragoandfulcrum.website/pl/movie/master.m3u8?token=server";
    const fresh = direct.replace("server", "viewer");
    vi.mocked(prepareBrowserStream).mockReturnValueOnce(Promise.resolve(fresh));
    await engine.load("https://relay.example/?url=film", "hls", undefined, undefined, direct);
    expect(prepareBrowserStream).toHaveBeenCalledWith(direct);
    expect(FakeHls.instances.at(-1)!.url).toBe(fresh);
    engine.destroy();
  });

  it("does not let a slow token response replace a newer movie", async () => {
    const { engine } = newEngine();
    let finish!: (url: string) => void;
    vi.mocked(prepareBrowserStream).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const old = engine.load("https://relay.example/old", "hls");
    await engine.load("https://cdn.example/new.m3u8", "hls");
    finish("https://cdn.example/old.m3u8");
    await old;
    expect(FakeHls.instances).toHaveLength(1);
    expect(FakeHls.instances[0]!.url).toBe("https://cdn.example/new.m3u8");
    engine.destroy();
  });

  it("reports a token failure without attempting the blocked relay", async () => {
    const { engine, states } = newEngine();
    vi.mocked(prepareBrowserStream).mockReturnValueOnce(Promise.reject(new Error("Provider blocked")));
    await engine.load("https://relay.example/?url=film", "hls");
    expect(FakeHls.instances).toHaveLength(0);
    expect(states.at(-1)).toMatchObject({ state: "error", error: "SOURCE_NOT_DIRECTLY_PLAYABLE" });
    engine.destroy();
  });
});

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

describe("a direct address that the browser plays itself", () => {
  const PROXIED = "http://kino.test/api/proxy?url=https%3A%2F%2Fcdn.example%2Fa.m3u8";
  const DIRECT = "https://cdn.example/a.m3u8";
  beforeEach(() => {
    FakeHls.supported = false; // (the browser has no hls.js to run, only its own player)
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

describe("lostTheConnection", () => {
  it("is a network error that got no answer: refused, dropped or timed out", () => {
    expect(lostTheConnection({ type: "networkError", details: "fragLoadError" })).toBe(true); // (no response at all)
    expect(lostTheConnection({ type: "networkError", details: "fragLoadError", response: { code: 0 } })).toBe(true); // (what a failed request is called)
    expect(lostTheConnection({ type: "networkError", details: "manifestLoadTimeOut" })).toBe(true);
    expect(lostTheConnection({ type: "networkError", details: "fragLoadTimeOut", response: { code: 504 } })).toBe(true); // (a time-out is a time-out whatever came with it)
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
