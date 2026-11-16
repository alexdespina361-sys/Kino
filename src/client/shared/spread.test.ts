import { describe, expect, it } from "vitest";
import type { LibraryRow } from "../../shared";
import { MIN_KEEP, spreadOf, spreadRows } from "./spread";

const row = (id: string, ids: string[]): LibraryRow => ({ id, title: id, source: "Test", items: ids.map((one) => ({ id: one, title: one, url: `https://example.org/${one}` })) });
const ids = (rows: LibraryRow[]) => rows.map((one) => one.items.map((item) => item.id).join(" "));
const many = (prefix: string, count: number) => Array.from({ length: count }, (_, at) => `${prefix}${at}`);

describe("spreading the first rows (`spreadRows`)", () => {
  it("keeps the first row's order, and puts first in a later row the titles no row above it has, in their own order", () => {
    expect(ids(spreadRows([row("trending", ["a", "b", "c"]), row("action", ["a", "x", "b", "y"])]))).toEqual(["a b c", "x y a b"]);
  });

  it("puts the titles shown in fewer rows above before the ones shown in more", () => {
    const rows = spreadRows([row("one", ["a", "b"]), row("two", ["a", "c"]), row("three", ["a", "b", "z"])]);
    expect(ids(rows)[2]).toBe("z b a");
  });

  it(`leaves out a title already in two rows above, but never takes a row under ${MIN_KEEP} titles`, () => {
    const long = many("t", MIN_KEEP);
    const rows = spreadRows([row("one", ["a", "b"]), row("two", ["a", "b"]), row("three", [...long, "a", "b"]), row("four", ["a", "b", "c"])]);
    expect(ids(rows)[2]).toBe(long.join(" ")); // (a and b were in two rows above: out, and the row still has twelve)
    expect(ids(rows)[3]).toBe("c a b"); // (a short row keeps them, at its end)
  });

  it("leaves out the titles shown most first when only some can go", () => {
    const long = many("t", MIN_KEEP - 1);
    const rows = spreadRows([row("one", ["a", "b"]), row("two", ["a", "b"]), row("three", ["a"]), row("four", [...long, "a", "b"])]);
    expect(ids(rows)[3]).toBe([...long, "b"].join(" ")); // (a was in three rows above, b in two: room for one to go)
  });

  it("gives back the very same row when nothing in it moves, and works out a list of rows once", () => {
    const first = row("one", ["a", "b"]);
    const second = row("two", ["c", "d"]);
    const rows = [first, second];
    const spread = spreadRows(rows);
    expect(spread[0]).toBe(first);
    expect(spread[1]).toBe(second);
    expect(spreadOf(rows)).toBe(spreadOf(rows));
  });

  it("looks only at a row's own titles: a row's further pages are not its to move", () => {
    const rows = spreadRows([row("one", ["a"]), row("two", ["a", "b"])]);
    expect(rows[1]!.items.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
