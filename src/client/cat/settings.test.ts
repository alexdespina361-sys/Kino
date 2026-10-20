import { describe, expect, it } from "vitest";
import { isTvAgent } from "../role";
import { catAsk, catLook, parseCatSettings, wantsCat } from "./settings";

describe("what this device says about the cat", () => {
  it("is off on every device until somebody turns it on, and quiet on a TV's browser", () => {
    expect(parseCatSettings(undefined, false)).toEqual({ on: false, quiet: false, films: true, detail: true });
    expect(parseCatSettings(undefined, true)).toEqual({ on: false, quiet: true, films: true, detail: true });
    expect(parseCatSettings("", true)).toEqual({ on: false, quiet: true, films: true, detail: true });
  });

  it("reads what was stored, and takes anything it does not understand for the default", () => {
    expect(parseCatSettings(JSON.stringify({ on: true, quiet: false, films: false }), true)).toEqual({ on: true, quiet: false, films: false, detail: true });
    expect(parseCatSettings(JSON.stringify({ on: true }), true)).toEqual({ on: true, quiet: true, films: true, detail: true });
    expect(parseCatSettings(JSON.stringify({ on: "yes", quiet: 1, films: null, detail: "no" }), false)).toEqual({ on: false, quiet: false, films: true, detail: true });
    expect(parseCatSettings("{not json", true)).toEqual({ on: false, quiet: true, films: true, detail: true });
    expect(parseCatSettings("[1,2]", false)).toEqual({ on: false, quiet: false, films: true, detail: true });
    expect(parseCatSettings("null", false)).toEqual({ on: false, quiet: false, films: true, detail: true });
  });

  it("keeps a device's choice of the simple cat, and a cat that was saved before there was a choice is the detailed one", () => {
    expect(parseCatSettings(JSON.stringify({ on: true, detail: false }), false).detail).toBe(false);
    expect(parseCatSettings(JSON.stringify({ on: true, quiet: false, films: true }), false).detail).toBe(true);
  });

  it("is told what the address asks for", () => {
    expect(catAsk("?cat=on")).toBe("on");
    expect(catAsk("?cat=1")).toBe("on");
    expect(catAsk("?x=1&cat=debug")).toBe("debug");
    expect(catAsk("?cat=off")).toBe("off");
    expect(catAsk("?cat=0")).toBe("off");
    expect(catAsk("?cat=banana")).toBeUndefined();
    expect(catAsk("")).toBeUndefined();
  });

  it("is told what the address asks of its look", () => {
    expect(catLook("?catart=classic")).toBe("classic");
    expect(catLook("?cat=on&catart=solid")).toBe("solid");
    expect(catLook("?catart=banana")).toBeUndefined();
    expect(catLook("?cat=on")).toBeUndefined();
    expect(catLook("")).toBeUndefined();
  });

  it("wants a cat when the device does, unless the address says otherwise either way", () => {
    const off = { on: false, quiet: false, films: true, detail: true };
    const on = { ...off, on: true };
    expect(wantsCat(off, undefined)).toBe(false);
    expect(wantsCat(on, undefined)).toBe(true);
    expect(wantsCat(off, "on")).toBe(true);
    expect(wantsCat(off, "debug")).toBe(true);
    expect(wantsCat(on, "off")).toBe(false);
  });
});

describe("which browsers are a TV's", () => {
  it("knows the ones the website already knows", () => {
    expect(isTvAgent("Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/6.0 TV Safari/537.36")).toBe(true);
    expect(isTvAgent("Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/79.0.3945.79 Safari/537.36")).toBe(true);
    expect(isTvAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe(false);
  });
});
