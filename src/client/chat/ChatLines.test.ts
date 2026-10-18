import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatLines } from "./ChatLines";
import { count, has, line, tagOf } from "./fixtures";

const NOW = Date.UTC(2026, 9, 18, 15, 0);
const render = (props: Partial<Parameters<typeof ChatLines>[0]> = {}) =>
  renderToStaticMarkup(createElement(ChatLines, { lines: [line(1, false), line(2, true), line(3, false)], name: "Sam", now: NOW, ...props }));

describe("the messages of a chat", () => {
  it("are a line each, in the order they came, and say whose they are", () => {
    const html = render();
    expect(count(html, "chat-line")).toBe(3);
    expect([...html.matchAll(/data-line="(\d+)" data-mine="(true|false)"/g)].map((match) => `${match[1]}:${match[2]}`)).toEqual(["1:false", "2:true", "3:false"]);
    expect(html).toMatch(/message 1[\s\S]*message 2[\s\S]*message 3/);
  });

  it("are text and nothing else: markup is shown as typed, and a link is not one", () => {
    const html = render({ lines: [line(1, false, "<img src=x onerror=alert(1)> https://example.com/a?b=1 <a href='https://evil.test'>hi</a>")] });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
    expect(html).not.toMatch(/<[a-z][^>]*\shref=/i); // (the words "href=" are in the text, escaped; no element has one)
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("https://example.com/a?b=1");
  });

  it("begin each day with a line that says which, the first one too", () => {
    const day = (date: number, hour: number) => Date.UTC(2026, 9, date, hour);
    const html = render({ lines: [line(1, false, "a", day(16, 10)), line(2, true, "b", day(16, 11)), line(3, false, "c", day(17, 10))] });
    expect(count(html, "chat-day")).toBe(2);
  });

  it("say who wrote each line when asked to (a report), and only then", () => {
    expect(render().includes("chat-writer")).toBe(false);
    expect(count(render({ showWriter: true }).replace(/class="chat-writer"/g, 'data-testid="writer"'), "writer")).toBe(3);
  });

  it("are only read when nothing is to be done with them: a line of one's own is not a button", () => {
    const html = render();
    expect(html).not.toContain("<button");
    expect(count(html, "chat-bubble")).toBe(0);
  });

  it("let a line of one's own be pressed (not the friend's), and offer to take back the one that was", () => {
    const html = render({ onPick: () => {}, onTakeBack: () => {}, picked: 2 });
    expect(count(html, "chat-bubble")).toBe(1);
    expect(tagOf(html, "chat-bubble")).toContain('aria-expanded="true"');
    expect(count(html, "chat-takeback")).toBe(1);
    // it sits under the line that was picked
    expect(html).toMatch(/data-line="2"[\s\S]*chat-takeback[\s\S]*data-line="3"/);
  });

  it("offer nothing when none is picked", () => {
    const html = render({ onPick: () => {}, onTakeBack: () => {}, picked: null });
    expect(count(html, "chat-bubble")).toBe(1);
    expect(tagOf(html, "chat-bubble")).toContain('aria-expanded="false"');
    expect(has(html, "chat-takeback")).toBe(false);
  });

  it("are a place the remote can land on, when it is the TV's", () => {
    const html = render({ remote: true, testId: "tv-chat-lines" });
    expect(tagOf(html, "tv-chat-lines")).toContain('tabindex="0"');
    expect(tagOf(html, "tv-chat-lines")).toContain("data-nav");
    expect(tagOf(render(), "chat-lines")).not.toContain("data-nav");
  });

  it("are a log with a name, for a screen reader", () => {
    const tag = tagOf(render(), "chat-lines")!;
    expect(tag).toContain('role="log"');
    expect(tag).toContain('aria-label="Chat with Sam"');
  });
});
