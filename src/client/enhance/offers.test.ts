import { describe, expect, it } from "vitest";
import { biggest, enhanceOffers, firstTier, isTwoK, readChoice, readTiers, sizeClass, twoKSize, Watch } from "./offers";

const both = { upscale: true, boost: true };
const upscaleOnly = { upscale: true, boost: false };

describe("the ✦ choices of the Quality list", () => {
  it("offers 2K and 2K at 60 fps below 2K, and 60 fps alone for a film that is 2K already (the owner's rule)", () => {
    expect(enhanceOffers({ width: 1280, height: 720 }, 24, both)).toEqual(["2k", "2k60"]);
    expect(enhanceOffers({ width: 1920, height: 804 }, 23.976, both)).toEqual(["2k", "2k60"]);
    expect(enhanceOffers({ width: 2560, height: 1440 }, 24, both)).toEqual(["60"]);
    expect(enhanceOffers({ width: 3840, height: 1608 }, 24, both)).toEqual(["60"]);
  });

  it("leaves the 60 fps ones out where frames between cannot be made, or the film has 50 a second already", () => {
    expect(enhanceOffers({ width: 1280, height: 720 }, 24, upscaleOnly)).toEqual(["2k"]);
    expect(enhanceOffers({ width: 2560, height: 1440 }, 24, upscaleOnly)).toEqual([]);
    expect(enhanceOffers({ width: 1280, height: 720 }, 50, both)).toEqual(["2k"]);
    expect(enhanceOffers({ width: 1280, height: 720 }, 0, both)).toEqual(["2k", "2k60"]); // (not known yet: the usual films are 24-30)
  });

  it("offers nothing where the picture cannot be redrawn, or its size is not known", () => {
    expect(enhanceOffers({ width: 1280, height: 720 }, 24, { upscale: false, boost: false })).toEqual([]);
    expect(enhanceOffers(undefined, 24, both)).toEqual([]);
    expect(enhanceOffers({ width: 0, height: 0 }, 24, both)).toEqual([]);
  });

  it("calls 2K what the quality labels call 2K, a film's own shape too", () => {
    expect(isTwoK({ width: 2560, height: 1072 })).toBe(true);
    expect(isTwoK({ width: 1920, height: 1080 })).toBe(false);
  });

  it("draws 2K in the film's own shape, as big as fits in 2560 x 1440", () => {
    expect(twoKSize({ width: 1280, height: 720 })).toEqual({ width: 2560, height: 1440 });
    expect(twoKSize({ width: 1280, height: 536 })).toEqual({ width: 2560, height: 1072 });
    expect(twoKSize({ width: 960, height: 720 })).toEqual({ width: 1920, height: 1440 }); // (4:3)
    expect(twoKSize({ width: 854, height: 480 })).toEqual({ width: 2560, height: 1438 }); // (never wider than 2560)
  });

  it("finds the biggest quality that says its size", () => {
    expect(biggest([{ width: 640, height: 360 }, { width: 1920, height: 1080 }, { height: 720 }])).toEqual({ width: 1920, height: 1080 });
    expect(biggest([{}, { width: 0, height: 0 }])).toBeUndefined();
    expect(biggest([{ height: 720 }, { height: 1440 }])).toEqual({ width: 2560, height: 1440 }); // (files called "720p" and "1440p": 2K already)
  });
});

describe("the watch on a device that draws too slowly", () => {
  it("says nothing in the warm-up, nor while few frames are late", () => {
    const watch = new Watch(12, 48, 0.2);
    for (let frame = 0; frame < 12; frame++) expect(watch.note(true)).toBe("ok"); // (the programs are built then)
    for (let frame = 0; frame < 200; frame++) expect(watch.note(frame % 10 === 0)).toBe("ok"); // (one in ten late)
    expect(watch.held).toBe(200);
  });

  it("says slow once, when more than a fifth of the last frames were late", () => {
    const watch = new Watch(12, 48, 0.2);
    for (let frame = 0; frame < 12; frame++) watch.note(false);
    const said = Array.from({ length: 100 }, (_, frame) => watch.note(frame % 3 === 0)); // (one in three late)
    expect(said.filter((one) => one === "slow")).toHaveLength(1);
    expect(said.indexOf("slow")).toBe(47); // (as soon as the window is full)
    expect(watch.held).toBe(0);
  });
});

describe("what a device remembers", () => {
  it("keeps the way that kept up per size of picture, and starts with Anime4K where there is WebGPU, else FSR 1", () => {
    expect(sizeClass(480)).toBe("sd");
    expect(sizeClass(720)).toBe("hd");
    expect(sizeClass(804)).toBe("hd");
    expect(sizeClass(1080)).toBe("fhd");
    expect(firstTier({}, 720, true)).toBe("anime");
    expect(firstTier({}, 720, false)).toBe("sharp");
    expect(firstTier({ fhd: "sharp" }, 1080, true)).toBe("sharp");
    expect(firstTier({ hd: "anime" }, 720, false)).toBe("sharp"); // (WebGPU gone since: a browser updated or a flag)
    expect(firstTier({ hd: "slow" }, 720, true)).toBe("slow"); // (a kept choice is left off for it; a pick tries FSR 1 again: enhancer.ts)
    expect(firstTier({ hd: "slow" }, 480, true)).toBe("anime"); // (another size of picture is another question)
  });

  it("reads back only what it wrote", () => {
    expect(readTiers('{"hd":"anime","fhd":"sharp","sd":"bogus","x":"anime"}')).toEqual({ hd: "anime", fhd: "sharp" });
    expect(readTiers("not json")).toEqual({});
    expect(readTiers(null)).toEqual({});
    expect(readChoice("2k")).toBe("2k");
    expect(readChoice("4k")).toBe("off");
    expect(readChoice(null)).toBe("off");
  });
});
