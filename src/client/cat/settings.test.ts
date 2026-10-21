import { describe, expect, it } from "vitest";
import { isTvAgent } from "../role";
import { CAT_SIZE_FACTOR, CAT_SIZES, catAsk, catCoatAsk, catLook, catSizeAsk, parseCatSettings, wantsCat, type CatSettings } from "./settings";

/** What a device that has said nothing gets, a TV's browser being quiet. */
const base = (over: Partial<CatSettings> = {}): CatSettings => ({ on: false, quiet: false, films: true, detail: true, coat: "ginger", size: "normal", ...over });

describe("what this device says about the cat", () => {
  it("is off on every device until somebody turns it on, and quiet on a TV's browser", () => {
    expect(parseCatSettings(undefined, false)).toEqual(base());
    expect(parseCatSettings(undefined, true)).toEqual(base({ quiet: true }));
    expect(parseCatSettings("", true)).toEqual(base({ quiet: true }));
  });

  it("reads what was stored, and takes anything it does not understand for the default", () => {
    expect(parseCatSettings(JSON.stringify({ on: true, quiet: false, films: false }), true)).toEqual(base({ on: true, films: false }));
    expect(parseCatSettings(JSON.stringify({ on: true }), true)).toEqual(base({ on: true, quiet: true }));
    expect(parseCatSettings(JSON.stringify({ on: "yes", quiet: 1, films: null, detail: "no", coat: 4, size: {} }), false)).toEqual(base());
    expect(parseCatSettings("{not json", true)).toEqual(base({ quiet: true }));
    expect(parseCatSettings("[1,2]", false)).toEqual(base());
    expect(parseCatSettings("null", false)).toEqual(base());
  });

  it("keeps a device's choice of the simple cat, and a cat that was saved before there was a choice is the detailed one", () => {
    expect(parseCatSettings(JSON.stringify({ on: true, detail: false }), false).detail).toBe(false);
    expect(parseCatSettings(JSON.stringify({ on: true, quiet: false, films: true }), false).detail).toBe(true);
  });

  it("keeps a device's coat and size, and a coat or a size that is not one of ours is the usual one", () => {
    expect(parseCatSettings(JSON.stringify({ coat: "tuxedo", size: "large" }), false)).toMatchObject({ coat: "tuxedo", size: "large" });
    expect(parseCatSettings(JSON.stringify({ coat: "calico", size: "small" }), true)).toMatchObject({ coat: "calico", size: "small" });
    expect(parseCatSettings(JSON.stringify({ coat: "purple", size: "huge" }), false)).toMatchObject({ coat: "ginger", size: "normal" });
    expect(parseCatSettings(JSON.stringify({ on: true }), false)).toMatchObject({ coat: "ginger", size: "normal" });
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

  it("is told what the address asks of its look, its coat and its size", () => {
    expect(catLook("?catart=classic")).toBe("classic");
    expect(catLook("?cat=on&catart=solid")).toBe("solid");
    expect(catLook("?catart=banana")).toBeUndefined();
    expect(catLook("?cat=on")).toBeUndefined();
    expect(catLook("")).toBeUndefined();
    expect(catCoatAsk("?cat=on&catcoat=tuxedo")).toBe("tuxedo");
    expect(catCoatAsk("?catcoat=grey")).toBe("grey");
    expect(catCoatAsk("?catcoat=zebra")).toBeUndefined();
    expect(catCoatAsk("")).toBeUndefined();
    expect(catSizeAsk("?catsize=large")).toBe("large");
    expect(catSizeAsk("?catsize=enormous")).toBeUndefined();
    expect(catSizeAsk("")).toBeUndefined();
  });

  it("has a factor for every size, with the usual size as it is", () => {
    for (const size of CAT_SIZES) expect(CAT_SIZE_FACTOR[size]).toBeGreaterThan(0);
    expect(CAT_SIZE_FACTOR.normal).toBe(1);
    expect(CAT_SIZE_FACTOR.small).toBeLessThan(CAT_SIZE_FACTOR.normal);
    expect(CAT_SIZE_FACTOR.large).toBeGreaterThan(CAT_SIZE_FACTOR.normal);
  });

  it("wants a cat when the device does, unless the address says otherwise either way", () => {
    const off = base();
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
