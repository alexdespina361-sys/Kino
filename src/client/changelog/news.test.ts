import { describe, expect, it } from "vitest";
import { dayOf, freshFor, LATEST, linesOf, newer } from "./news";
import { CHANGELOG } from "./notes";

describe("what's new: the versions", () => {
  it("orders versions by their numbers, not as text", () => {
    expect(newer("0.4.10", "0.4.9")).toBe(true);
    expect(newer("0.5.0", "0.4.12")).toBe(true);
    expect(newer("0.4.2", "0.4.2")).toBe(false);
    expect(newer("0.4.1", "0.4.2")).toBe(false);
    expect(newer("0.4", "0.4.0")).toBe(false);
    expect(newer("1.0.0", "garbage")).toBe(true);
  });

  it("is news only to a screen that showed an older version: a first visit is not told, everything being new to it", () => {
    expect(freshFor(undefined, "0.4.3")).toBe(false);
    expect(freshFor("0.4.2", "0.4.3")).toBe(true);
    expect(freshFor("0.4.3", "0.4.3")).toBe(false);
    expect(freshFor("0.5.0", "0.4.3")).toBe(false); // (a screen that saw a later one, from a newer page, is not told of an older one)
  });

  it("the tile's newest version is the list's first, and the list goes from the newest down, each a day not before the next one's", () => {
    expect(CHANGELOG[0]).toMatchObject({ version: LATEST.version, date: LATEST.date });
    for (let at = 1; at < CHANGELOG.length; at++) {
      expect(newer(CHANGELOG[at - 1]!.version, CHANGELOG[at]!.version), CHANGELOG[at]!.version).toBe(true);
      expect(CHANGELOG[at - 1]!.date >= CHANGELOG[at]!.date, CHANGELOG[at]!.version).toBe(true);
    }
    expect(new Set(CHANGELOG.map((note) => note.version)).size).toBe(CHANGELOG.length);
  });

  it("every version says the same number of things in each language, none empty, none too long for a TV's line", () => {
    for (const note of CHANGELOG) {
      expect(note.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(note.en.length, note.version).toBeGreaterThan(0);
      expect(note.ro.length, note.version).toBe(note.en.length);
      expect(note.it.length, note.version).toBe(note.en.length);
      for (const line of [...note.en, ...note.ro, ...note.it]) {
        expect(line.trim(), note.version).toBe(line);
        expect(line.length, line).toBeGreaterThan(8);
        expect(line.length, line).toBeLessThanOrEqual(160);
      }
      // (Each line is its own key in the list: two the same would be one.)
      for (const lines of [note.en, note.ro, note.it]) expect(new Set(lines).size, note.version).toBe(lines.length);
    }
  });

  it("says nothing that is not for the people who watch: no addresses, no sources, no tools, no names of the ones who built it", () => {
    const words = CHANGELOG.flatMap((note) => [...note.en, ...note.ro, ...note.it]).join("\n");
    for (const banned of [/https?:/i, /\b[a-z0-9-]+\.(com|ro|me|sh|pro|cyou|space|sc|online|org|net)\b/i, /\brelay\b/i, /\bCDN\b/, /\bHLS\b/, /\bMP4\b/, /\bAPI\b/, /Gemini|Codex|Claude|Antigravity/i, /\bPostgres/i, /\bKLIPY_KEY\b/, /PERSONAL_STICKERS/]) {
      expect(words).not.toMatch(banned);
    }
  });

  it("the lines are in the page's language, English where one is missing", () => {
    const note = { version: "9.9.9", date: "2030-01-01", en: ["One"], ro: ["Unu"], it: ["Uno"] };
    expect(linesOf(note, "ro")).toEqual(["Unu"]);
    expect(linesOf({ ...note, it: undefined as unknown as string[] }, "it")).toEqual(["One"]);
  });

  it("writes the day in the page's language, and never moves it by a time zone", () => {
    expect(dayOf("2026-11-17", "en")).toMatch(/17 November 2026|November 17, 2026/);
    expect(dayOf("2026-11-17", "ro")).toMatch(/17 noiembrie 2026/);
    expect(dayOf("2026-11-17", "it")).toMatch(/17 novembre 2026/);
    expect(dayOf("2026-11-17", "en", true)).toMatch(/17 Nov|Nov 17/);
    expect(dayOf("not a day", "en")).toBe("not a day");
  });
});
