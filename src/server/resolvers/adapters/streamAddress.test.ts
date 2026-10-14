import { describe, expect, it } from "vitest";
import { streamAddress } from "./streamAddress";

const raw = "https://cdn.example/hls/master.m3u8?token=a b";
const page = "https://player.example/embed/1";
const asked = (base: string) => `${base}?url=${encodeURIComponent(raw)}&referer=${encodeURIComponent(page)}`;

describe("streamAddress", () => {
  it("is this server's proxy unless something else is set up", () => {
    expect(streamAddress(raw, page, {})).toBe(asked("/api/proxy"));
    expect(streamAddress(raw, page, { DIRECT_STREAMING: "false", EDGE_STREAM_PROXY_URL: "  " })).toBe(asked("/api/proxy"));
  });

  it("is the relay's, with or without a slash at the end of its address", () => {
    expect(streamAddress(raw, page, { EDGE_STREAM_PROXY_URL: "https://kino-edge.example.workers.dev" })).toBe(asked("https://kino-edge.example.workers.dev"));
    expect(streamAddress(raw, page, { EDGE_STREAM_PROXY_URL: " https://kino-edge.example.workers.dev/ " })).toBe(asked("https://kino-edge.example.workers.dev"));
  });

  it("is the other end's own address when asked to be", () => {
    expect(streamAddress(raw, page, { DIRECT_STREAMING: "true" })).toBe(raw);
  });

  it("is the relay's even when the other end's own address is asked for too, which a browser from another website would be turned away from", () => {
    expect(streamAddress(raw, page, { DIRECT_STREAMING: "true", EDGE_STREAM_PROXY_URL: "https://kino-edge.example.workers.dev" })).toBe(asked("https://kino-edge.example.workers.dev"));
  });
});
