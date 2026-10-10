import { describe, expect, it } from "vitest";
import {
  CAPTION_LABELS,
  CAPTION_SETTINGS,
  CAPTION_TITLES,
  CAPTION_VALUES,
  CaptionStyleSchema,
  DEFAULT_CAPTION_STYLE,
  resolveCaptionStyle,
} from "./captions";

describe("caption style", () => {
  it("has a title and a label for every setting and value, so every menu can list them", () => {
    for (const setting of CAPTION_SETTINGS) {
      expect(CAPTION_TITLES[setting], setting).toBeTruthy();
      for (const value of CAPTION_VALUES[setting]) expect((CAPTION_LABELS[setting] as Record<string, string>)[value], `${setting}=${value}`).toBeTruthy();
    }
  });

  it("starts from a default that is itself valid", () => {
    expect(CaptionStyleSchema.safeParse(DEFAULT_CAPTION_STYLE).success).toBe(true);
  });

  it("puts what the viewer changed on top of the defaults", () => {
    expect(resolveCaptionStyle()).toEqual(DEFAULT_CAPTION_STYLE);
    expect(resolveCaptionStyle({ color: "yellow", spacing: "wide" })).toEqual({ ...DEFAULT_CAPTION_STYLE, color: "yellow", spacing: "wide" });
  });

  it("ignores values that are not a real choice", () => {
    expect(resolveCaptionStyle({ color: "plaid" as never, size: undefined })).toEqual(DEFAULT_CAPTION_STYLE);
  });

  it("accepts a partial change as a command, and nothing outside the choices", () => {
    expect(CaptionStyleSchema.partial().safeParse({ size: "large" }).success).toBe(true);
    expect(CaptionStyleSchema.partial().safeParse({ size: "gigantic" }).success).toBe(false);
  });
});
