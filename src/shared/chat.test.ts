import { describe, expect, it } from "vitest";
import { CHAT_KEEP_MAX, CHAT_REPORT_LINES, CHAT_TEXT_MAX, ChatReportPreviewSchema, ChatSendSchema, ChatThreadSchema, checkChatText } from "./chat";

describe("what may be written", () => {
  it("is trimmed, and a line break or a run of spaces reads as one space", () => {
    expect(checkChatText("  hello  ")).toEqual({ ok: true, text: "hello" });
    expect(checkChatText("one\ntwo\r\n\tthree    four")).toEqual({ ok: true, text: "one two three four" });
  });

  it("is not empty, and not just something that cannot be seen", () => {
    expect(checkChatText("")).toEqual({ ok: false, error: "empty" });
    expect(checkChatText("   \n\t ")).toEqual({ ok: false, error: "empty" });
    expect(checkChatText("​‮⁦­")).toEqual({ ok: false, error: "empty" });
  });

  it("has no characters that hide or turn text around", () => {
    expect(checkChatText("a‮b⁦c\u0007d‏e")).toEqual({ ok: true, text: "abcde" });
  });

  it("keeps emoji whole, and makes a half of a pair into a replacement character", () => {
    expect(checkChatText("see you \u{1F44B}\u{1F3FD} \u{1F468}‍\u{1F469}‍\u{1F467}")).toEqual({ ok: true, text: "see you \u{1F44B}\u{1F3FD} \u{1F468}‍\u{1F469}‍\u{1F467}" });
    expect(checkChatText("a\ud83dz")).toEqual({ ok: true, text: "a�z" });
  });

  it("may be as long as the limit and not longer, counting what is left after it is cleaned", () => {
    expect(checkChatText("x".repeat(CHAT_TEXT_MAX))).toMatchObject({ ok: true });
    expect(checkChatText("x".repeat(CHAT_TEXT_MAX + 1))).toEqual({ ok: false, error: "too_long" });
    expect(checkChatText(`  ${"x".repeat(CHAT_TEXT_MAX)}  \n\n  `)).toMatchObject({ ok: true });
    expect(checkChatText(`${"x ".repeat(CHAT_TEXT_MAX)}`)).toEqual({ ok: false, error: "too_long" });
  });

  it("is left as text: a link is only letters, and is not made into anything", () => {
    expect(checkChatText('<b>look</b> https://example.com/?a=1&b="2"')).toEqual({ ok: true, text: '<b>look</b> https://example.com/?a=1&b="2"' });
  });

  it("is not an address of KLIPY's that a page would not draw as the GIF it says it is; a real one, and any other address, are taken", () => {
    const gif = "https://static1.klipy.com/ii/abc/12/34/xyz.webp";
    expect(checkChatText(` ${gif} `)).toEqual({ ok: true, text: gif });
    expect(checkChatText(`${gif}?w=220`)).toEqual({ ok: true, text: `${gif}?w=220` });
    for (const fake of [
      "https://static1.klipy.com:8443/ii/abc/x.webp",
      "https://someone:pw@static.klipy.com/x.gif",
      "http://static.klipy.com/x.gif",
      "https://static.klipy.com/x.svg",
      "https://static.klipy.com.evil.example/x.gif",
      "https://evil.example/static.klipy.com/x.gif",
      "javascript:static.klipy.com",
    ]) {
      expect(checkChatText(fake), fake).toEqual({ ok: false, error: "not_a_picture" });
    }
    expect(checkChatText("look at https://static.klipy.com:8443/x.gif")).toMatchObject({ ok: true });
    expect(checkChatText("https://www.youtube.com/watch?v=x")).toMatchObject({ ok: true });
    expect(checkChatText("klipy.com is where the GIFs come from")).toMatchObject({ ok: true });
  });
});

describe("what travels", () => {
  const line = { id: 1, at: 2, mine: true, text: "hi" };

  it("is a chat with or without its messages", () => {
    expect(ChatThreadSchema.safeParse({ rev: 3, open: true, muted: false }).success).toBe(true);
    expect(ChatThreadSchema.safeParse({ rev: 3, open: true, muted: false, lines: [line] }).success).toBe(true);
    expect(ChatThreadSchema.safeParse({ rev: -1, open: true, muted: false }).success).toBe(false);
    expect(ChatThreadSchema.safeParse({ rev: 3, open: true, muted: false, lines: Array.from({ length: CHAT_KEEP_MAX + 1 }, () => line) }).success).toBe(false);
    expect(ChatThreadSchema.safeParse({ rev: 3, open: true, muted: false, lines: [{ ...line, text: "x".repeat(CHAT_TEXT_MAX + 1) }] }).success).toBe(false);
  });

  it("holds no more in a report than the report takes", () => {
    expect(ChatReportPreviewSchema.safeParse({ rev: 1, lines: Array.from({ length: CHAT_REPORT_LINES }, () => line) }).success).toBe(true);
    expect(ChatReportPreviewSchema.safeParse({ rev: 1, lines: Array.from({ length: CHAT_REPORT_LINES + 1 }, () => line) }).success).toBe(false);
  });

  it("takes a lot of text from a page and leaves measuring it to the server", () => {
    expect(ChatSendSchema.safeParse({ text: "x".repeat(CHAT_TEXT_MAX * 2) }).success).toBe(true);
    expect(ChatSendSchema.safeParse({ text: "x".repeat(CHAT_TEXT_MAX * 4 + 1) }).success).toBe(false);
    expect(ChatSendSchema.safeParse({}).success).toBe(false);
  });
});
