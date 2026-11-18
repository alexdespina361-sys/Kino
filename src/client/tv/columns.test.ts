import { describe, expect, it } from "vitest";
import { columnsFor, pageWidth, PITCH_EM } from "./columns";

const DRAWN = [
  [8, PITCH_EM.poster],
  [4, PITCH_EM.category],
  [5, PITCH_EM.wide],
  [5, PITCH_EM.poster],
] as const;
const across = (width: number) => DRAWN.map(([drawn, pitch]) => columnsFor(width, drawn, pitch));

describe("the page's width", () => {
  it("is 100 units on any 16 by 9 screen, a TV's or a computer's up to 1920 by 1080", () => {
    for (const [width, height] of [
      [1280, 720],
      [1920, 1080],
      [3840, 2160],
    ] as const) {
      expect(pageWidth(width, height, false)).toBeCloseTo(100, 0);
    }
    expect(pageWidth(1280, 720, true)).toBeCloseTo(100, 0);
    expect(pageWidth(1920, 1080, true)).toBeCloseTo(100, 0);
  });

  it("is wider on a computer's monitor past 1920 by 1080 (the page stops growing there), and in a window wider than 16 by 9", () => {
    expect(pageWidth(2560, 1440, true)).toBeCloseTo(133.3, 0);
    expect(pageWidth(3440, 1440, true)).toBeCloseTo(179.2, 0);
    expect(pageWidth(2560, 1440, false)).toBeCloseTo(100, 0);
    expect(pageWidth(1920, 800, false)).toBeCloseTo(135, 0);
  });
});

describe("how many tiles a grid is across", () => {
  it("is what the page was drawn with at 100 units: eight posters, four categories, five wide tiles, five beside the keys", () => {
    expect(across(100)).toEqual([8, 4, 5, 5]);
    expect(across(pageWidth(1920, 1080, true))).toEqual([8, 4, 5, 5]);
    expect(across(pageWidth(3840, 2160, false))).toEqual([8, 4, 5, 5]);
  });

  it("has one more for each tile's room the page is wider", () => {
    expect(across(pageWidth(2560, 1440, true))).toEqual([11, 5, 7, 8]);
    expect(across(pageWidth(3440, 1440, true))).toEqual([15, 7, 9, 12]);
  });
});
