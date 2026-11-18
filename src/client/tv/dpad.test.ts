import { describe, expect, it } from "vitest";
import { pickInRows, pickNeighbour, type Box } from "./dpad";

const box = (left: number, top: number, width = 10, height = 4): Box => ({ left, top, right: left + width, bottom: top + height });

describe("pickNeighbour", () => {
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
    const boxes = [box(40, 10), box(30, 30, 6), box(41, 50)];
    expect(pickNeighbour(boxes, 0, "down")).toBe(2);
  });

  it("finds nothing when alone or when the start is not a box", () => {
    expect(pickNeighbour([box(0, 0)], 0, "right")).toBe(-1);
    expect(pickNeighbour([], 0, "right")).toBe(-1);
  });

  it("goes to the button right under, not to a wide one further down that happens to be centred nearer", () => {
    const editor = [box(0, 0, 10, 10), box(12, 0, 10, 10), box(24, 0, 10, 10), box(0, 12, 14, 6), box(16, 12, 18, 6), box(0, 20, 34, 6)];
    expect(pickNeighbour(editor, 0, "down")).toBe(3);
    expect(pickNeighbour(editor, 1, "down")).toBe(4);
    expect(pickNeighbour(editor, 2, "down")).toBe(4);
    expect(pickNeighbour(editor, 3, "down")).toBe(5);
    expect(pickNeighbour(editor, 4, "down")).toBe(5);
    expect(pickNeighbour(editor, 5, "up")).toBe(4);
  });

  it("does not take a wide row for the neighbour of the buttons it holds, or the other way round", () => {
    const settings = [box(0, 0, 6), box(8, 0, 6), box(16, 0, 6), box(0, 8, 22)];
    expect(pickNeighbour(settings, 3, "right")).toBe(-1);
    expect(pickNeighbour(settings, 3, "left")).toBe(-1);
    expect(pickNeighbour(settings, 3, "down")).toBe(-1);
    expect(pickNeighbour(settings, 3, "up")).toBe(1);
    expect(pickNeighbour(settings, 2, "down")).toBe(3);
  });

  it("still reaches a lone button that sits to one side, when nothing is straight ahead", () => {
    const sides = [box(40, 0, 20), box(0, 10, 10)];
    expect(pickNeighbour(sides, 0, "down")).toBe(1);
    expect(pickNeighbour(sides, 1, "up")).toBe(0);
  });

  it("from a wide box, lands on the button next to it, not on the first of a row of buttons of one size (the chat's box and its round buttons)", () => {
    const row = [box(0, 0, 4, 4), box(6, 0, 4, 4), box(12, 0, 4, 4), box(18, 0, 60, 4)];
    expect(pickNeighbour(row, 3, "left")).toBe(2);
    expect(pickNeighbour(row, 2, "left")).toBe(1);
    expect(pickNeighbour(row, 0, "right")).toBe(1);
    const offLine = [box(0, 0, 4, 4), box(12, 2, 4, 4), box(18, 0, 60, 4)];
    expect(pickNeighbour(offLine, 2, "left")).toBe(0);
  });
});

describe("pickInRows", () => {
  const bar = [box(0, 0, 10, 10), box(12, 3, 6), box(20, 3, 6), box(0, 14, 14), box(16, 14, 8), box(26, 14, 8), box(36, 14, 4)];

  it("walks along a row and stops at its ends, without wrapping to the other row", () => {
    expect(pickInRows(bar, 0, "right")).toBe(1);
    expect(pickInRows(bar, 1, "right")).toBe(2);
    expect(pickInRows(bar, 2, "right")).toBe(-1);
    expect(pickInRows(bar, 1, "left")).toBe(0);
    expect(pickInRows(bar, 0, "left")).toBe(-1);
    expect(pickInRows(bar, 3, "left")).toBe(-1);
    expect(pickInRows(bar, 6, "right")).toBe(-1);
  });

  it("steps to the other row, onto the button nearest the same spot", () => {
    expect(pickInRows(bar, 0, "down")).toBe(3);
    expect(pickInRows(bar, 2, "down")).toBe(4);
    expect(pickInRows(bar, 5, "up")).toBe(2);
    expect(pickInRows(bar, 6, "up")).toBe(2);
    expect(pickInRows(bar, 3, "up")).toBe(0);
  });

  it("finds nothing above the first row, below the last, or in a bar of one row", () => {
    expect(pickInRows(bar, 1, "up")).toBe(-1);
    expect(pickInRows(bar, 4, "down")).toBe(-1);
    const single = [box(0, 0), box(12, 0), box(24, 0)];
    expect(pickInRows(single, 1, "down")).toBe(-1);
    expect(pickInRows(single, 1, "up")).toBe(-1);
    expect(pickInRows(single, 1, "right")).toBe(2);
    expect(pickInRows([], 0, "right")).toBe(-1);
  });
});
