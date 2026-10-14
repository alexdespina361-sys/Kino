import { describe, expect, it } from "vitest";
import { isMediaUrl } from "./media";
import { parseClientMessage, parseServerMessage } from "./protocol";

const msg = (value: unknown) => JSON.stringify(value);
const load = (url: string) => msg({ type: "CMD", command: { type: "LOAD", media: { stream: { url, type: "mp4" } } } });

describe("parseClientMessage", () => {
  it("accepts a LOAD with an absolute http(s) URL", () => {
    expect(parseClientMessage(load("https://example.com/a.mp4"))).not.toBeNull();
  });

  it("accepts a root-relative fixture path", () => {
    expect(parseClientMessage(load("/fixtures/sample.mp4"))).not.toBeNull();
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "data:video/mp4;base64,AAAA", "//evil.example/x.mp4", "ftp://x/y.mp4", "not a url"])(
    "rejects media URL %s",
    (url) => {
      expect(parseClientMessage(load(url))).toBeNull();
    },
  );

  it("rejects malformed input without throwing", () => {
    expect(parseClientMessage("{not json")).toBeNull();
    expect(parseClientMessage(msg({ type: "NOPE" }))).toBeNull();
    expect(parseClientMessage(Buffer.from("x"))).toBeNull();
    expect(parseClientMessage(msg({ type: "CMD", command: { type: "SEEK", time: -5 } }))).toBeNull();
    expect(parseClientMessage(msg({ type: "CMD", command: { type: "SEEK" } }))).toBeNull();
  });

  it("accepts the five player commands", () => {
    for (const command of [{ type: "PLAY" }, { type: "PAUSE" }, { type: "STOP" }, { type: "SEEK", time: 10 }]) {
      expect(parseClientMessage(msg({ type: "CMD", command }))).not.toBeNull();
    }
  });

  it("only accepts the player states from the spec", () => {
    const state = (s: string) => msg({ type: "TV_STATE", state: { state: s, currentTime: 0, duration: 0 } });
    for (const s of ["idle", "loading", "playing", "paused", "error"]) expect(parseClientMessage(state(s))).not.toBeNull();
    expect(parseClientMessage(state("exploding"))).toBeNull();
  });
});

describe("parseServerMessage", () => {
  it("round-trips a valid message and drops an invalid one", () => {
    expect(parseServerMessage(msg({ type: "TV_STATUS", online: true }))).toEqual({ type: "TV_STATUS", online: true });
    expect(parseServerMessage(msg({ type: "TV_STATUS" }))).toBeNull();
  });
});

describe("newer protocol pieces", () => {
  const cmd = (command: unknown) => msg({ type: "CMD", command });

  it("accepts SKIP within a sane range and rejects nonsense", () => {
    expect(parseClientMessage(cmd({ type: "SKIP", seconds: -10 }))).not.toBeNull();
    expect(parseClientMessage(cmd({ type: "SKIP", seconds: 30 }))).not.toBeNull();
    expect(parseClientMessage(cmd({ type: "SKIP", seconds: 99_999 }))).toBeNull();
    expect(parseClientMessage(cmd({ type: "SKIP", seconds: "10" }))).toBeNull();
    expect(parseClientMessage(cmd({ type: "SKIP" }))).toBeNull();
  });

  it("accepts startAt on LOAD and PLAY_URL, but not a negative or absurd one", () => {
    const media = { stream: { url: "/fixtures/sample.mp4", type: "mp4" } };
    expect(parseClientMessage(cmd({ type: "LOAD", media, startAt: 120 }))).not.toBeNull();
    expect(parseClientMessage(cmd({ type: "LOAD", media, startAt: -1 }))).toBeNull();
    expect(parseClientMessage(msg({ type: "PLAY_URL", url: "https://a.example/x", startAt: 61.5 }))).not.toBeNull();
    expect(parseClientMessage(msg({ type: "PLAY_URL", url: "https://a.example/x", startAt: 1e9 }))).toBeNull();
  });

  it("takes caption style changes as a partial and rejects values outside the choices", () => {
    const command = (style: unknown) => parseClientMessage(msg({ type: "CMD", command: { type: "SET_CAPTION_STYLE", style } }));
    expect(command({ color: "yellow" })).not.toBeNull();
    expect(command({})).not.toBeNull();
    expect(command({ color: "plaid" })).toBeNull();
    expect(command(undefined)).toBeNull();
  });

  it("takes a source index, and rejects one that cannot exist", () => {
    const command = (index: unknown) => parseClientMessage(msg({ type: "CMD", command: { type: "SET_SOURCE", index } }));
    expect(command(0)).not.toBeNull();
    expect(command(8)).not.toBeNull();
    expect(command(9)).toBeNull();
    expect(command(-1)).toBeNull();
    expect(command("1")).toBeNull();
  });

  it("knows PING, UNPAIR, PONG, TV_UNPAIRED and TV_RESOLVING", () => {
    expect(parseClientMessage(msg({ type: "PING" }))).toEqual({ type: "PING" });
    expect(parseClientMessage(msg({ type: "UNPAIR" }))).toEqual({ type: "UNPAIR" });
    expect(parseClientMessage(msg({ type: "TV_UNPAIR" }))).toEqual({ type: "TV_UNPAIR" });
    expect(parseServerMessage(msg({ type: "PONG" }))).toEqual({ type: "PONG" });
    expect(parseServerMessage(msg({ type: "TV_RESOLVING", active: true }))).not.toBeNull();
    expect(parseServerMessage(msg({ type: "TV_RESOLVING" }))).toBeNull();
    expect(parseServerMessage(msg({ type: "TV_UNPAIRED", pairing: { code: "123456", expiresInMs: 5 } }))).not.toBeNull();
    expect(parseServerMessage(msg({ type: "TV_UNPAIRED", pairing: null }))).not.toBeNull();
  });

  it("a PING may say how long the round trip took, and a TV_SYNC how old its position is; neither may be nonsense", () => {
    expect(parseClientMessage(msg({ type: "PING", rtt: 83 }))).toEqual({ type: "PING", rtt: 83 });
    for (const rtt of [-1, 60_001, "83", null]) expect(parseClientMessage(msg({ type: "PING", rtt }))).toBeNull();
    const sync = { type: "TV_SYNC", playing: true, time: 10, rate: 1 };
    expect(parseServerMessage(msg(sync))).toEqual(sync);
    expect(parseServerMessage(msg({ ...sync, lag: 0.08 }))).toEqual({ ...sync, lag: 0.08 });
    for (const lag of [-0.1, 2.5, "0.1"]) expect(parseServerMessage(msg({ ...sync, lag }))).toBeNull();
  });

  it("a TV_SYNC may say who held the film and that it only waits for data; a TV_CMD that an admin guest steered, whose it was", () => {
    const sync = { type: "TV_SYNC", playing: false, time: 10, rate: 1 };
    expect(parseServerMessage(msg({ ...sync, by: "a1b2c3d4e5f6", waiting: true }))).toEqual({ ...sync, by: "a1b2c3d4e5f6", waiting: true });
    expect(parseServerMessage(msg(sync))).toEqual(sync); // (an older server says neither)
    for (const by of [1, null, "x".repeat(101)]) expect(parseServerMessage(msg({ ...sync, by }))).toBeNull();
    expect(parseServerMessage(msg({ ...sync, waiting: "yes" }))).toBeNull();

    const pause = { type: "TV_CMD", command: { type: "PAUSE" } };
    expect(parseServerMessage(msg({ ...pause, by: "a1b2c3d4e5f6" }))).toEqual({ ...pause, by: "a1b2c3d4e5f6" });
    expect(parseServerMessage(msg(pause))).toEqual(pause);
    expect(parseServerMessage(msg({ ...pause, by: 7 }))).toBeNull();
  });

  it("player state carries optional buffering info", () => {
    const state = { state: "playing", currentTime: 5, duration: 60, buffering: true, bufferedEnd: 42 };
    expect(parseClientMessage(msg({ type: "TV_STATE", state }))).not.toBeNull();
    expect(parseClientMessage(msg({ type: "TV_STATE", state: { ...state, bufferedEnd: -1 } }))).toBeNull();
  });

  it("player state says when the picture has ended and when the next episode is on its way, and the phone can turn that down", () => {
    const state = (extra: unknown) => parseClientMessage(msg({ type: "TV_STATE", state: { state: "paused", currentTime: 60, duration: 60, ...(extra as object) } }));
    expect(state({ ended: true })?.type).toBe("TV_STATE");
    expect(state({ upNext: { seconds: 8 } })).not.toBeNull();
    expect(state({ upNext: { seconds: null } })).not.toBeNull(); // a viewer who plays the next one only on request: the card has no count
    expect(state({ upNext: { seconds: -1 } })).toBeNull();
    expect(state({ upNext: {} })).toBeNull();
    expect(parseClientMessage(msg({ type: "CMD", command: { type: "DISMISS_UP_NEXT" } }))).not.toBeNull();
  });
});

describe("media helpers", () => {
  it("isMediaUrl allows only http(s) and root-relative paths", () => {
    expect(isMediaUrl("http://a/b")).toBe(true);
    expect(isMediaUrl("/fixtures/a.mp4")).toBe(true);
    expect(isMediaUrl("//a/b")).toBe(false);
    expect(isMediaUrl("file:///a")).toBe(false);
  });
});
