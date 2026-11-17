import { describe, expect, it } from "vitest";
import { afterSent, boxText, cutTo } from "./MessageBox";

describe("the message box", () => {
  it("reads its text as one line, its kept spaces plain", () => {
    expect(boxText("one\ntwo\r\nthree")).toBe("one two three");
    expect(boxText("a b")).toBe("a b");
  });

  it("cuts a long text to the limit, never in the middle of a letter", () => {
    expect(cutTo("hello", 10)).toBe("hello");
    expect(cutTo("hello", 3)).toBe("hel");
    const smile = "\u{1F600}"; // (two units)
    expect(cutTo(`${"a".repeat(499)}${smile}`, 500)).toBe("a".repeat(499)); // (half of it would be a box with a question mark)
    expect(cutTo(`${"a".repeat(498)}${smile}`, 500)).toBe(`${"a".repeat(498)}${smile}`);
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}"; // (one letter of five pieces, eight units)
    expect(cutTo(`ab${family}`, 6)).toBe("ab");
    const flag = "\u{1F1F7}\u{1F1F4}";
    expect(cutTo(`x${flag}`, 3)).toBe("x");
    expect(cutTo("x".repeat(1_000_000), 500)).toHaveLength(500); // (a pasted book: only its start is looked at)
  });

  it("keeps what was typed while a message was on its way, and takes away only the message", () => {
    expect(afterSent("hi", "hi")).toBe("");
    expect(afterSent("hi and more", "hi")).toBe("and more");
    expect(afterSent("this", "hi")).toBe("this"); // (changed while it was on its way: none of it is taken away, never "ts")
    expect(afterSent("", "hi")).toBe("");
  });
});
