import { describe, expect, it } from "vitest";
import { backTo } from "./placeScroll";

describe("where a place of the phone's bar is put back", () => {
  it("is as far into the place as it was left, when nothing above it changed", () => {
    expect(backTo({ y: 400, top: 120 }, 120)).toBe(400);
  });

  it("is not moved by a line that came above the place while it was read and is gone again (the browser moved the window with the line)", () => {
    // Search scrolled to 400 with its top at 120; a title is played, "Looking it up…" (56 px) comes in above the place and the browser keeps what was in
    // view in view (400 -> 456, the top now at 176), and that is what was kept. The film is stopped, the line is gone: the place is where it was read.
    expect(backTo({ y: 456, top: 176 }, 120)).toBe(400);
  });

  it("keeps what was read in view when a line comes above the place while it is put back", () => {
    expect(backTo({ y: 400, top: 120 }, 176)).toBe(456);
  });

  it("is the top for a place left at the top, whatever came above it since", () => {
    expect(backTo({ y: 0, top: 120 }, 176)).toBe(0);
    expect(backTo({ y: 0, top: 176 }, 120)).toBe(0);
  });

  it("is never above the page", () => {
    expect(backTo({ y: 30, top: 176 }, 120)).toBe(0);
  });
});
