import { describe, expect, it } from "vitest";
import { pickNeighbour, type Box } from "./dpad";

const box = (left: number, top: number, width = 10, height = 4): Box => ({ left, top, right: left + width, bottom: top + height });

describe("pickNeighbour", () => {
  // Two buttons side by side, and a link under them: the shape of the TV's start screens.
  const screen = [box(20, 40), box(40, 40, 14), box(30, 60, 20)];

  it("moves sideways to the button beside, and not past the last one", () => {
    expect(pickNeighbour(screen, 0, "right")).toBe(1);
    expect(pickNeighbour(screen, 1, "left")).toBe(0);
    expect(pickNeighbour(screen, 0, "left")).toBe(-1);
    expect(pickNeighbour(screen, 1, "right")).toBe(-1);
  });

  it("moves down to the link and back up, from either button", () => {
    expect(pickNeighbour(screen, 0, "down")).toBe(2);
    expect(pickNeighbour(screen, 1, "down")).toBe(2);
    expect(pickNeighbour(screen, 2, "up")).not.toBe(-1);
    expect(pickNeighbour(screen, 2, "down")).toBe(-1);
  });

  it("prefers the one in line over a nearer one off to the side", () => {
    // From the top box, going down: the first below is nearer but well to the left; the second is further down and right under.
    const boxes = [box(40, 10), box(30, 30, 6), box(41, 50)];
    expect(pickNeighbour(boxes, 0, "down")).toBe(2);
  });

  it("finds nothing when alone or when the start is not a box", () => {
    expect(pickNeighbour([box(0, 0)], 0, "right")).toBe(-1);
    expect(pickNeighbour([], 0, "right")).toBe(-1);
  });
});
