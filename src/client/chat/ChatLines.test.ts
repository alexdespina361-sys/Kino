import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatLines } from "./ChatLines";
import { count, has, line, tagOf } from "./fixtures";
import { askAbout, forgetTitles } from "./titleCache";

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

describe("a message that names a title", () => {
  const LINK = "https://kino.24-7.ro/tv?title=movie-603";
  const matrix = { id: "filmpire-movie-603", title: "The Matrix", year: 1999, image: "https://image.example/m.jpg", url: "/fixtures/a.mp4" };
  beforeEach(() => forgetTitles());
  afterEach(() => vi.unstubAllGlobals());
  const known = async (answer: unknown) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ item: answer })));
    await askAbout(matrix.id);
  };

  it("has a card the size it will have while the server is asked, with the words and not yet the poster", () => {
    const html = render({ lines: [line(1, false, `Tonight? ${LINK}`)], onOpenTitle: () => {} });
    expect(count(html, "chat-card-loading")).toBe(1);
    expect(html).toContain("Tonight?");
    expect(html).not.toContain(LINK); // (the address is the card's, not the words')
  });

  it("is a card with the poster and the name once it is known, which is a button only when it can open the title", async () => {
    await known(matrix);
    const html = render({ lines: [line(1, false, `The Matrix (1999) ${LINK}`)], onOpenTitle: () => {} });
    expect(count(html, "chat-card")).toBe(1);
    expect(tagOf(html, "chat-card")).toMatch(/^<button/);
    expect(tagOf(html, "chat-card")).toContain('data-title="filmpire-movie-603"');
    expect(html).toContain("https://image.example/m.jpg");
    expect(html).not.toContain(LINK);
    expect(html).not.toMatch(/<a\s/);
    expect(tagOf(render({ lines: [line(1, false, LINK)] }), "chat-card")).toMatch(/^<span/); // (nothing to open it with: only shown)
  });

  it("is a card the remote is given by the list, not by the D-pad (a card scrolled out of view is still on the page)", async () => {
    await known(matrix);
    const tag = tagOf(render({ lines: [line(1, true, LINK)], remote: true, onOpenTitle: () => {} }), "chat-card")!;
    expect(tag).toContain('tabindex="-1"');
    expect(tag).not.toContain("data-nav");
  });

  it("sits under the bubble of one's own line, not in it (the bubble is the button that takes it back)", async () => {
    await known(matrix);
    const html = render({ lines: [line(1, true, `Watch it ${LINK}`)], onPick: () => {}, onTakeBack: () => {}, picked: null, onOpenTitle: () => {} });
    expect(html).toMatch(/data-testid="chat-bubble"[^]*?<\/button><button[^>]*data-testid="chat-card"/);
  });

  it("is only the text in a report, as it is sent, and the text for a title nobody knows", async () => {
    await known(matrix);
    const report = render({ lines: [line(1, false, `Tonight? ${LINK}`)], showWriter: true, onOpenTitle: () => {} });
    expect(has(report, "chat-card")).toBe(false);
    expect(report).toContain(LINK);
    forgetTitles();
    await known(null);
    const unknown = render({ lines: [line(1, false, `Tonight? ${LINK}`)], onOpenTitle: () => {} });
    expect(has(unknown, "chat-card")).toBe(false);
    expect(unknown).toContain(`Tonight? ${LINK}`);
  });
});
