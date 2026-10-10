import { describe, expect, it } from "vitest";
import { describeChange } from "./feedback";
import type { PlayerState } from "./protocol";

const playing = (extra: Partial<PlayerState> = {}): PlayerState => ({
  state: "playing",
  currentTime: 120,
  duration: 2700,
  stream: "https://cdn.example/1.m3u8",
  playbackRate: 1,
  subtitles: { tracks: [{ id: 0, label: "English" }, { id: 1, label: "Dutch" }], current: -1 },
  audio: { tracks: [{ id: 0, label: "English" }, { id: 1, label: "Français" }], current: 0 },
  quality: { levels: [{ id: 0, label: "720p" }, { id: 1, label: "1080p" }], current: -1 },
  ...extra,
});

describe("describeChange", () => {
  it("says nothing when nothing changed, or only the time did", () => {
    expect(describeChange(playing(), playing())).toBeUndefined();
    expect(describeChange(playing(), playing({ currentTime: 121 }))).toBeUndefined();
  });

  it("names a new speed", () => {
    expect(describeChange(playing(), playing({ playbackRate: 1.5 }))).toBe("Speed 1.5×");
    expect(describeChange(playing({ playbackRate: 2 }), playing())).toBe("Speed 1×");
  });

  it("names a subtitle track, or says they are off", () => {
    expect(describeChange(playing(), playing({ subtitles: { ...playing().subtitles!, current: 1 } }))).toBe("Subtitles: Dutch");
    expect(describeChange(playing({ subtitles: { ...playing().subtitles!, current: 1 } }), playing())).toBe("Subtitles off");
  });

  it("names an audio track and a quality", () => {
    expect(describeChange(playing(), playing({ audio: { ...playing().audio!, current: 1 } }))).toBe("Audio: Français");
    expect(describeChange(playing(), playing({ quality: { ...playing().quality!, current: 1 } }))).toBe("Quality: 1080p");
    expect(describeChange(playing({ quality: { ...playing().quality!, current: 1 } }), playing())).toBe("Quality: Auto");
  });

  it("stays quiet while a video starts: another video, loading, and what the player sets up by itself in the first second", () => {
    expect(describeChange(playing(), playing({ stream: "https://cdn.example/2.m3u8", playbackRate: 1.5 }))).toBeUndefined();
    expect(describeChange(playing({ state: "loading" }), playing({ playbackRate: 1.5 }))).toBeUndefined();
    expect(describeChange(playing({ currentTime: 0 }), playing({ currentTime: 0, subtitles: { ...playing().subtitles!, current: 0 } }))).toBeUndefined();
  });

  it("works from a paused state too, and says one thing at a time", () => {
    expect(describeChange(playing({ state: "paused" }), playing({ state: "paused", playbackRate: 0.75 }))).toBe("Speed 0.75×");
    expect(describeChange(playing(), playing({ playbackRate: 2, subtitles: { ...playing().subtitles!, current: 0 } }))).toBe("Speed 2×");
  });
});
