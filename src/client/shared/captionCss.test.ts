import { describe, expect, it } from "vitest";
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from "../../shared";
import { captionBottom, captionTextStyle } from "./captionCss";

const style = (changes: Partial<CaptionStyle>): CaptionStyle => ({ ...DEFAULT_CAPTION_STYLE, ...changes });

describe("captionTextStyle", () => {
  it("sizes the text as a share of the picture height, in the unit it is given", () => {
    expect(captionTextStyle(style({ size: "xlarge" }), "cqh").fontSize).toBe("7.6cqh");
  });

  it("measures the picture on a screen as the 16:9 one that fits it, and never lets the text get unreadably small", () => {
    // A screen as high as it is wide enough for: the picture is the screen's height. A narrower one: the picture is a strip.
    expect(captionTextStyle(style({ size: "medium" })).fontSize).toBe("max(14px, calc(min(100vh, 56.25vw) * 4.6 / 100))");
  });

  it("makes the text color and its opacity one color, and the plate behind it another", () => {
    const css = captionTextStyle(style({ color: "yellow", textOpacity: "75", background: "25" }));
    expect(css.color).toBe("rgba(255, 235, 59, 0.75)");
    expect(css.backgroundColor).toBe("rgba(0, 0, 0, 0.25)");
    expect(captionTextStyle(style({ background: "0" })).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });

  it("applies word spacing, font and edge", () => {
    expect(captionTextStyle(style({ spacing: "wide" })).wordSpacing).toBe("0.25em");
    expect(captionTextStyle(style({ font: "smallcaps" })).fontVariant).toBe("small-caps");
    expect(captionTextStyle(style({ edge: "none" })).textShadow).toBe("none");
    expect(captionTextStyle(style({ edge: "outline" })).textShadow).toContain("#000");
  });
});

describe("captionBottom", () => {
  it("raises the captions step by step", () => {
    const heights = (["low", "normal", "high", "higher"] as const).map((position) => parseFloat(captionBottom(style({ position }), "cqh")));
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(new Set(heights).size).toBe(4);
  });

  it("puts them over the picture, not the bottom of a screen that is taller than the picture", () => {
    expect(captionBottom(style({ position: "normal" }))).toBe("calc((100vh - min(100vh, 56.25vw)) / 2 + calc(min(100vh, 56.25vw) * 10 / 100))");
    expect(captionBottom(style({ position: "normal" }), "cqh")).toBe("10cqh");
  });
});
