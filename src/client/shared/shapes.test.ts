import { describe, expect, it } from "vitest";
import type { LibraryItem, LibraryRow } from "../../shared";
import { hasStills, landscapeRows } from "./shapes";

const item = (id: string, still = true): LibraryItem => ({ id, title: id, url: `https://x/${id}`, image: `https://img/${id}.jpg`, ...(still ? { backdrop: `https://img/${id}-wide.jpg` } : {}) });
const row = (id: string, stills = 20, without = 0): LibraryRow => ({
  id,
  title: id,
  source: "TMDB",
  items: [...Array.from({ length: stills }, (_, at) => item(`${id}${at}`)), ...Array.from({ length: without }, (_, at) => item(`${id}n${at}`, false))],
});

describe("row shapes", () => {
  it("draws the second row of the library wide, then every third one", () => {
    const rows = Array.from({ length: 11 }, (_, at) => row(`r${at}`));
    expect([...landscapeRows(rows)]).toEqual(["r1", "r4", "r7", "r10"]);
  });

  it("never draws the first row wide (the TV's top ten, the phone's picture at the top)", () => {
    expect(landscapeRows([row("r0")]).size).toBe(0);
  });

  it("gives a row without stills a miss: the next row that has them takes the turn, and the rhythm goes on from there", () => {
    const rows = [row("r0"), row("r1", 0, 20), row("r2"), row("r3"), row("r4"), row("r5")];
    expect([...landscapeRows(rows)]).toEqual(["r2", "r5"]);
  });

  it("wants nine in ten of a row's first twenty titles to have a still, and six titles at least", () => {
    expect(hasStills(row("a", 18, 2))).toBe(true);
    expect(hasStills(row("b", 17, 3))).toBe(false);
    expect(hasStills(row("c", 5))).toBe(false);
    expect(hasStills(row("d", 6))).toBe(true);
    // (Only the first twenty count: a row whose later titles have none keeps its shape as they come in.)
    expect(hasStills(row("e", 20, 40))).toBe(true);
  });

  it("keeps the shape of a row as rows come in under it", () => {
    const rows = Array.from({ length: 5 }, (_, at) => row(`r${at}`));
    const more = [...rows, ...Array.from({ length: 5 }, (_, at) => row(`s${at}`))];
    const first = landscapeRows(rows);
    const later = landscapeRows(more);
    for (const id of first) expect(later.has(id)).toBe(true);
  });
});
