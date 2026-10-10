import { describe, expect, it } from "vitest";
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from "../../shared";
import { captionBottom, captionTextStyle } from "./captionCss";

const style = (changes: Partial<CaptionStyle>): CaptionStyle => ({ ...DEFAULT_CAPTION_STYLE, ...changes });

describe("captionTextStyle", () => {
  it("sizes the text as a share of the picture height, in the unit it is given", () => {
    expect(captionTextStyle(style({ size: "medium" })).fontSize).toBe("4.6vh");
    expect(captionTextStyle(style({ size: "xlarge" }), "cqh").fontSize).toBe("7.6cqh");
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
    const heights = (["low", "normal", "high", "higher"] as const).map((position) => parseFloat(captionBottom(style({ position }))));
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(new Set(heights).size).toBe(4);
  });
});
