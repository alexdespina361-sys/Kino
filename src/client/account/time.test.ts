import { describe, expect, it } from "vitest";
import { ago, clockTime, dayChip, dayWord } from "./time";

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);

describe("ago", () => {
  it("says now for the last moments, then minutes, hours and days", () => {
    expect(ago(NOW - 5_000, NOW, "en")).toBe("now");
    expect(ago(NOW - 5 * 60_000, NOW, "en")).toBe("5 minutes ago");
    expect(ago(NOW - 3 * 3_600_000, NOW, "en")).toBe("3 hours ago");
    expect(ago(NOW - 86_400_000, NOW, "en")).toBe("yesterday");
    expect(ago(NOW - 5 * 86_400_000, NOW, "en")).toBe("5 days ago");
  });

  it("speaks the language of the site", () => {
    expect(ago(NOW - 5 * 60_000, NOW, "ro")).toBe("acum 5 minute");
    expect(ago(NOW - 5 * 60_000, NOW, "it")).toBe("5 minuti fa");
  });

  it("falls back to English for a language it does not know", () => {
    expect(ago(NOW - 5 * 60_000, NOW, "not a language!")).toBe("5 minutes ago");
  });
});

describe("the day and the hour of a plan", () => {
  // The viewer's own clock, whatever the machine's time zone: so the moments are made by it, not by UTC. November 2026.
  const at = (day: number, hour = 0, minute = 0): number => new Date(2026, 10, day, hour, minute).getTime();
  const now = at(12, 14, 30); // Thursday the 12th

  it("says yesterday, today and tomorrow by the viewer's own calendar, from the first minute of the day to the last", () => {
    expect(dayWord(at(11, 23, 59), now, "en")).toBe("yesterday");
    expect(dayWord(at(12, 0, 0), now, "en")).toBe("today");
    expect(dayWord(at(12, 23, 59), now, "en")).toBe("today");
    expect(dayWord(at(13, 0, 0), now, "en")).toBe("tomorrow");
    expect(dayWord(at(13, 23, 59), now, "en")).toBe("tomorrow");
  });

  it("says the weekday for the days of the coming week, and the date for the rest", () => {
    expect(dayWord(at(14, 20), now, "en")).toBe("Saturday");
    expect(dayWord(at(18, 20), now, "en")).toBe("Wednesday");
    expect(dayWord(at(19, 20), now, "en")).toMatch(/^Thu,? 19 Nov$/); // (a week ahead is the date: "Thursday" would read as today)
    expect(dayWord(at(3, 20), now, "en")).toMatch(/^Tue,? 3 Nov$/);
  });

  it("speaks the language of the site", () => {
    expect(dayWord(at(13, 20), now, "ro")).toBe("mâine");
    expect(dayWord(at(12, 20), now, "ro")).toBe("azi");
    expect(dayWord(at(14, 20), now, "ro")).toBe("sâmbătă");
    expect(dayWord(at(13, 20), now, "it")).toBe("domani");
    expect(dayWord(at(14, 20), now, "it")).toBe("sabato");
  });

  it("falls back to English for a language it does not know", () => {
    expect(dayWord(at(14, 20), now, "not a language!")).toMatch(/^Sat,? 14 Nov$/);
    expect(clockTime(at(14, 20), "not a language!")).toBe("20:00");
    expect(dayChip(at(14, 20), now, "not a language!")).toMatch(/^Sat,? 14$/);
  });

  it("gives a button the short name of a day: today and tomorrow in words, the others by weekday and date", () => {
    expect(dayChip(at(12, 12), now, "en")).toBe("Today");
    expect(dayChip(at(13, 12), now, "en")).toBe("Tomorrow");
    expect(dayChip(at(14, 12), now, "en")).toMatch(/^Sat,? 14$/);
    expect(dayChip(at(18, 12), now, "en")).toMatch(/^Wed,? 18$/);
    expect(dayChip(at(13, 12), now, "ro")).toBe("Mâine");
    expect(dayChip(at(12, 12), now, "it")).toBe("Oggi");
    expect(dayChip(at(14, 12), now, "ro")).toMatch(/14/);
  });

  it("reads the hour on a twenty-four-hour clock, two figures each, in every language of the site", () => {
    for (const language of ["en", "ro", "it"]) {
      expect(clockTime(at(14, 20), language)).toBe("20:00");
      expect(clockTime(at(14, 9, 5), language)).toBe("09:05");
      expect(clockTime(at(14, 0, 0), language)).toBe("00:00");
    }
  });
});
