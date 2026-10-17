import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hold, isHeld } from "../subsync/hold";
import { AudioTap } from "../subsync/tap";
import { prepareBrowserStream } from "./browserStream";
import {
  DIRECT_START_MS,
  LONE_PROXY_BUFFER_AHEAD_S,
  LONE_PROXY_BUFFER_BYTES,
  PARTY_BUFFER_AHEAD_S,
  PARTY_BUFFER_BYTES,
  PlayerEngine,
  bufferPolicy,
  describeHlsError,
  lostTheConnection,
  proxiedQualityCap,
  type SyncFilm,
  type SyncStarter,
} from "./engine";

/** hls.js stands in for itself: the engine's wiring to it is what is looked at, not the library. */
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
    };
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

  /** An aligner that does nothing but record how it was used. */
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
  /** The video knows the film now (until then the state says only that it is loading). */
  const known = (video: FakeVideo) => void video.dispatchEvent(new Event("loadedmetadata"));
  /** The aligner's code has arrived (it is fetched along with the film, which does not wait for it) and has been started `count` times. */
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
    expect(hls.url).toBe(HLS); // (the film did not wait for it)
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
    // (The init segment comes once, at the start; the aligner was not there to hear it.)
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
    aligner.films[0]!.report("syncing"); // (a late word from the one that was closed)
    expect(engine.getState().subtitleSync).toBe("off");
    engine.setSubtitleSync(true);
    await started(aligner, 2);
    expect(aligner.films[1]!.hls).toBe(aligner.films[0]!.hls);
    expect(aligner.films[1]!.tap).toBe(aligner.films[0]!.tap); // (the player's own: it has listened all along)
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
    expect(aligner.handles[0]!.close).toHaveBeenCalledWith(); // (closed as it is: the lines of a film that is gone need no putting back)
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
      engine.setSubtitleSync(true); // (nothing to start on: still "unavailable")
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
    engine.useSubtitleSync(() => new Promise(() => {})); // (never arrives)
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
      { label: "Română", language: "ro", mode: "hidden" }, // (loaded for the aligner)
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
