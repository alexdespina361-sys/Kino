import { describe, expect, it } from "vitest";
import type { ChatLine, ChatThread } from "../../shared";
import { ApiError } from "../account/api";
import { applyThread, CHAT_FACTS, dayOf, endsChat, FRESH_CHAT, lastOwn, problemOf, stampOf, startsDay, type ChatState } from "./state";

const line = (id: number, mine: boolean, at = 1_000 * id, text = `m${id}`): ChatLine => ({ id, at, mine, text });
const thread = (rev: number, lines?: ChatLine[], rest: Partial<ChatThread> = {}): ChatThread => ({ rev, open: true, muted: false, ...(lines ? { lines } : {}), ...rest });

describe("what a failed call comes to", () => {
  it("is the server's word when the views have a sentence for it", () => {
    for (const code of ["rate_limited", "chat_off", "friends_off", "not_friends", "too_long", "empty", "gone", "changed", "offline"] as const) {
      expect(problemOf(new ApiError(code === "offline" ? 0 : 400, code))).toBe(code);
    }
  });

  it("is `other` for any other word, and for something that is not the server's answer", () => {
    expect(problemOf(new ApiError(500, "http_500"))).toBe("other");
    expect(problemOf(new ApiError(502, "bad_response"))).toBe("other");
    expect(problemOf(new Error("boom"))).toBe("other");
    expect(problemOf(undefined)).toBe("other");
  });

  it("ends the chat only when the friend is no friend any more, or friends are off", () => {
    expect(endsChat("not_friends")).toBe(true);
    expect(endsChat("friends_off")).toBe(true);
    for (const problem of ["offline", "rate_limited", "chat_off", "too_long", "empty", "gone", "changed", "other"] as const) expect(endsChat(problem)).toBe(false);
  });
});

describe("the chat after an answer", () => {
  it("takes the first answer as it is", () => {
    const state = applyThread(FRESH_CHAT, thread(10, [line(5, false), line(10, true)], { muted: true, open: false }));
    expect(state).toEqual({ rev: 10, open: false, muted: true, lines: [line(5, false), line(10, true)] });
  });

  it("keeps its messages when the answer has none because nothing changed, and takes the rest of the answer", () => {
    const before: ChatState = { rev: 10, open: true, muted: false, lines: [line(10, true)] };
    const after = applyThread(before, thread(10, undefined, { open: false, muted: true }));
    expect(after.lines).toBe(before.lines);
    expect(after).toMatchObject({ rev: 10, open: false, muted: true });
  });

  it("replaces its messages with those of a newer answer", () => {
    const before: ChatState = { rev: 10, open: true, muted: false, lines: [line(10, true)] };
    expect(applyThread(before, thread(20, [line(20, false)])).lines).toEqual([line(20, false)]);
  });

  it("ignores an answer older than what it has (a slow one that was overtaken)", () => {
    const before: ChatState = { rev: 20, open: true, muted: false, lines: [line(20, false)] };
    expect(applyThread(before, thread(10, [line(10, true)]))).toBe(before);
  });

  it("keeps its own idea of muting when a mute was answered after the reading began", () => {
    const before: ChatState = { rev: 10, open: true, muted: true, lines: [] };
    expect(applyThread(before, thread(11, [], { muted: false }), true).muted).toBe(true);
    expect(applyThread(before, thread(11, [], { muted: false }), false).muted).toBe(false);
  });
});

describe("the messages", () => {
  it("find the newest of one's own", () => {
    expect(lastOwn([line(1, true), line(2, false), line(3, true), line(4, false)])?.id).toBe(3);
    expect(lastOwn([line(1, false)])).toBeUndefined();
    expect(lastOwn([])).toBeUndefined();
  });

  it("say the hour, in the language of the site", () => {
    const at = new Date(2026, 9, 14, 9, 5).getTime();
    expect(stampOf(at, "en")).toBe("09:05");
    expect(stampOf(at, "ro")).toBe("09:05");
    expect(stampOf(at, "it")).toBe("09:05");
  });

  it("say the day in words for today and yesterday, and as a date for the others", () => {
    const now = new Date(2026, 9, 18, 15, 30).getTime();
    const day = (date: number, hour = 9) => new Date(2026, 9, date, hour).getTime();
    expect(dayOf(day(18, 0), now, "en")).toBe("today");
    expect(dayOf(day(17, 23), now, "en")).toBe("yesterday");
    expect(dayOf(day(14), now, "en")).toMatch(/14/);
    expect(dayOf(day(18), now, "ro")).toBe("azi");
    expect(dayOf(day(14), now, "ro")).toMatch(/14.*oct/i);
    expect(dayOf(day(18), now, "it")).toBe("oggi");
    expect(dayOf(day(14), now, "it")).toMatch(/14.*ott/i);
  });

  it("say nothing for a time that is not one", () => {
    expect(stampOf(Number.NaN, "en")).toBe("");
    expect(stampOf(1e300, "en")).toBe("");
    expect(dayOf(Number.NaN, 0, "en")).toBe("");
    expect(dayOf(1e300, 0, "en")).toBe("");
  });

  it("begin a day with the first of the day, and the very first", () => {
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();
    const lines = [line(1, true, at(17, 23)), line(2, false, at(17, 23)), line(3, true, at(18, 0)), line(4, true, at(18, 9))];
    expect(lines.map((_, index) => startsDay(lines, index))).toEqual([true, false, true, false]);
    expect(startsDay(lines, 9)).toBe(false);
  });
});

describe("the limits the views say in words", () => {
  it("are those of the server", () => {
    expect(CHAT_FACTS).toEqual({ messages: 200, days: 30, max: 500 });
  });
});
