import { describe, expect, it } from "vitest";
import { formatClock, formatEndsAt, formatLeft, formatLinkCode, formatRemaining, formatTime, hostOf } from "./format";

describe("formatLeft", () => {
  it("says what is left the way a person would", () => {
    expect(formatLeft(23 * 60)).toBe("23 min");
    expect(formatLeft(72 * 60)).toBe("1 h 12 min");
    expect(formatLeft(2 * 3600)).toBe("2 h");
    expect(formatLeft(89 * 60 + 40)).toBe("1 h 30 min"); // rounds to the minute
  });

  it("never says less than a minute, and treats nonsense as that", () => {
    expect(formatLeft(10)).toBe("1 min");
    expect(formatLeft(0)).toBe("1 min");
    expect(formatLeft(Number.NaN)).toBe("1 min");
  });
});

describe("formatTime", () => {
  it("shows minutes and seconds, and hours only when there are some", () => {
    expect(formatTime(75)).toBe("1:15");
    expect(formatTime(4522)).toBe("1:15:22");
    expect(formatTime(0)).toBe("0:00");
  });

  it("treats nonsense as zero", () => {
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(-5)).toBe("0:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("formatRemaining", () => {
  it("counts down what is left, and says nothing while the length is unknown", () => {
    expect(formatRemaining(10, 100)).toBe("-1:30");
    expect(formatRemaining(150, 100)).toBe("-0:00");
    expect(formatRemaining(10, 0)).toBe("");
  });
});

describe("formatClock and formatEndsAt", () => {
  const at = (h: number, m: number) => new Date(2026, 0, 1, h, m);

  it("writes a 24-hour time of day", () => {
    expect(formatClock(at(7, 5))).toBe("07:05");
    expect(formatClock(at(21, 48))).toBe("21:48");
  });

  it("says when the video ends, at the speed it is playing", () => {
    expect(formatEndsAt(0, 3600, 1, at(20, 0))).toBe("21:00");
    expect(formatEndsAt(1800, 3600, 1, at(20, 0))).toBe("20:30");
    expect(formatEndsAt(0, 3600, 2, at(20, 0))).toBe("20:30"); // double speed: half the time
    expect(formatEndsAt(0, 0, 1, at(20, 0))).toBe("");
  });
});

describe("formatLinkCode", () => {
  it("writes a sign-in code in two halves, and leaves anything else alone", () => {
    expect(formatLinkCode("ABCD2345")).toBe("ABCD-2345");
    expect(formatLinkCode("ABC")).toBe("ABC");
  });
});

describe("hostOf", () => {
  it("is the site's name without www, or nothing for a non-link", () => {
    expect(hostOf("https://www.example.com/watch/1?x=2")).toBe("example.com");
    expect(hostOf("not a link")).toBe("");
  });
});
