import { describe, expect, it } from "vitest";
import { gridRows, stepFrom, type Pos, type Shape, type Zone } from "./browseNav";

const at = (zone: Zone, row: number, col: number): Pos => ({ zone, row, col });

describe("gridRows", () => {
  it("lays things out in rows of a fixed width", () => {
    expect(gridRows(0, 3)).toEqual([]);
    expect(gridRows(7, 3)).toEqual([3, 3, 1]);
    expect(gridRows(6, 3)).toEqual([3, 3]);
  });
});

describe("stepFrom on rows of titles", () => {
  const shape: Shape = { rail: [1, 1, 1, 1], top: [1], rows: [8, 3, 5] };

  it("walks along a row and stops at its ends", () => {
    expect(stepFrom(shape, at("rows", 0, 2), "right")).toEqual(at("rows", 0, 3));
    expect(stepFrom(shape, at("rows", 1, 2), "right")).toBeNull();
    expect(stepFrom(shape, at("rows", 0, 3), "left")).toEqual(at("rows", 0, 2));
  });

  it("opens the menu from the first title of a row, whichever row", () => {
    expect(stepFrom(shape, at("rows", 0, 0), "left")).toEqual({ zone: "rail", row: -1, col: -1 });
    expect(stepFrom(shape, at("rows", 2, 0), "left")).toEqual({ zone: "rail", row: -1, col: -1 });
  });

  it("goes down and up between rows, keeping the column as far as the row has one", () => {
    expect(stepFrom(shape, at("rows", 0, 6), "down")).toEqual(at("rows", 1, 2));
    expect(stepFrom(shape, at("rows", 1, 2), "down")).toEqual(at("rows", 2, 2));
    expect(stepFrom(shape, at("rows", 2, 4), "up")).toEqual(at("rows", 1, 2));
    expect(stepFrom(shape, at("rows", 2, 4), "down")).toBeNull();
  });

  it("reaches Back from the top row and comes back down to where it was", () => {
    expect(stepFrom(shape, at("rows", 0, 3), "up")).toEqual(at("top", 0, 0));
    expect(stepFrom(shape, at("top", 0, 0), "down")).toEqual({ zone: "content", row: -1, col: -1 });
    expect(stepFrom(shape, at("top", 0, 0), "left")).toBeNull();
  });

  it("walks the menu up and down, and right goes back to the titles", () => {
    expect(stepFrom(shape, at("rail", 1, 0), "down")).toEqual(at("rail", 2, 0));
    expect(stepFrom(shape, at("rail", 0, 0), "up")).toBeNull();
    expect(stepFrom(shape, at("rail", 3, 0), "down")).toBeNull();
    expect(stepFrom(shape, at("rail", 2, 0), "right")).toEqual({ zone: "content", row: -1, col: -1 });
    expect(stepFrom(shape, at("rail", 2, 0), "left")).toBeNull();
  });

  it("does not offer Back when there is none", () => {
    expect(stepFrom({ rows: [3] }, at("rows", 0, 0), "up")).toBeNull();
  });
});

describe("stepFrom on the search page", () => {
  // Six keys across and a last row of two wide ones, then the results three across.
  const shape: Shape = { rail: [1, 1], top: [1], keys: [6, 6, 6, 2], results: gridRows(7, 3) };

  it("walks the keys, and the wide keys keep to what is above them", () => {
    expect(stepFrom(shape, at("keys", 0, 1), "right")).toEqual(at("keys", 0, 2));
    expect(stepFrom(shape, at("keys", 2, 1), "down")).toEqual(at("keys", 3, 0)); // Space is under the left three
    expect(stepFrom(shape, at("keys", 2, 4), "down")).toEqual(at("keys", 3, 1)); // Delete under the right three
    expect(stepFrom(shape, at("keys", 3, 0), "up")).toEqual(at("keys", 2, 1));
    expect(stepFrom(shape, at("keys", 3, 1), "up")).toEqual(at("keys", 2, 4));
  });

  it("goes from the keys across to the results, and back to the end of the keys' row", () => {
    expect(stepFrom(shape, at("keys", 1, 5), "right")).toEqual(at("results", 1, 0));
    expect(stepFrom(shape, at("keys", 3, 1), "right")).toEqual(at("results", 2, 0)); // as low as the results go
    expect(stepFrom(shape, at("results", 1, 0), "left")).toEqual(at("keys", 1, 5));
    expect(stepFrom(shape, at("results", 2, 0), "left")).toEqual(at("keys", 2, 5));
  });

  it("opens the menu from the keys' first column, and goes nowhere right with no results", () => {
    expect(stepFrom(shape, at("keys", 1, 0), "left")).toEqual({ zone: "rail", row: -1, col: -1 });
    expect(stepFrom({ ...shape, results: [] }, at("keys", 1, 5), "right")).toBeNull();
  });

  it("walks the results as a grid and goes up to Back from the first row", () => {
    expect(stepFrom(shape, at("results", 0, 1), "down")).toEqual(at("results", 1, 1));
    expect(stepFrom(shape, at("results", 1, 2), "down")).toEqual(at("results", 2, 0)); // the last row has one
    expect(stepFrom(shape, at("results", 0, 2), "up")).toEqual(at("top", 0, 0));
  });
});
