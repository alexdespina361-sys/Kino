import { describe, expect, it } from "vitest";
import { LONE_PROXY_BUFFER_AHEAD_S, LONE_PROXY_BUFFER_BYTES, PARTY_BUFFER_AHEAD_S, PARTY_BUFFER_BYTES, bufferPolicy, lostTheConnection } from "./engine";

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
