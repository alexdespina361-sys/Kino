import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CHAT_REACTIONS, type ChatLine } from "../../shared";
import { ChatLines } from "./ChatLines";
import { ReadTv } from "./ChatTv";
import { count, fakeReport, fakeSession, has, line, tagOf } from "./fixtures";
import { lastTheirs, ReactBar, ReactTv } from "./Reactions";

const NOW = Date.UTC(2026, 9, 18, 15, 0);
const HEART = "\u{2764}\u{FE0F}";
const FIRE = "\u{1F525}";
const with_ = (base: ChatLine, parts: Partial<ChatLine>): ChatLine => ({ ...base, ...parts });
const lines = (props: Partial<Parameters<typeof ChatLines>[0]> = {}) =>
  renderToStaticMarkup(createElement(ChatLines, { lines: [line(1, false), line(2, true), line(3, false)], name: "Sam", now: NOW, ...props }));
const lineOf = (html: string, id: number) => {
  const from = html.indexOf(`data-line="${id}"`);
  const next = html.indexOf('data-testid="chat-line"', from + 1);
  return html.slice(from, next < 0 ? undefined : next);
};

describe("reactions under a message", () => {
  it("show the friend's and one's own under the message, each the sticker's picture, saying whose it is", () => {
    const html = lines({ lines: [with_(line(1, false), { theirReaction: FIRE, myReaction: HEART }), line(2, true)] });
    expect(count(html, "chat-reaction")).toBe(2);
    const first = lineOf(html, 1);
    expect(first).toContain('data-who="theirs"');
    expect(first).toContain('data-who="mine"');
    expect(first).toContain('src="/stickers/fire.webp"');
    expect(first).toContain('src="/stickers/heart.webp"');
    expect(first).toContain(`aria-label="Sam reacted ${FIRE}"`);
    expect(first).toContain(`aria-label="You reacted ${HEART}"`);
    expect(has(lineOf(html, 2), "chat-reactions")).toBe(false);
  });

  it("show nothing for what is not one of the reactions (an old or broken record), and nothing in a report, which sends the words alone", () => {
    expect(has(lines({ lines: [with_(line(1, false), { theirReaction: "<b>", myReaction: "\u{1F680}" })] }), "chat-reactions")).toBe(false);
    expect(has(lines({ lines: [with_(line(1, false), { myReaction: "\u{1F37F}" })] }), "chat-reactions")).toBe(true);
    expect(has(lines({ lines: [with_(line(1, false), { theirReaction: FIRE })], showWriter: true }), "chat-reactions")).toBe(false);
  });

  it("are put from the bar under a selected message, the friend's too: six buttons, the one that is on pressed, and nothing else under it (Take back is at the top of the chat)", () => {
    const react = { onPick: () => {}, onReact: () => {} };
    const all = lines({ ...react, picked: null });
    expect(count(all, "chat-bubble"), "every message can be pressed").toBe(3);
    expect(has(all, "chat-react-bar")).toBe(false);

    const theirs = lines({ ...react, picked: 1, lines: [with_(line(1, false), { myReaction: FIRE }), line(2, true)] });
    const bar = lineOf(theirs, 1);
    expect(count(bar, "chat-react")).toBe(CHAT_REACTIONS.length);
    expect(bar).toMatch(new RegExp(`aria-pressed="true"[^>]*data-reaction="${FIRE}"`));
    expect(bar.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(has(theirs, "chat-takeback")).toBe(false);

    const mine = lineOf(lines({ ...react, picked: 2 }), 2);
    expect(has(mine, "chat-react-bar")).toBe(true);
    expect(has(mine, "chat-takeback")).toBe(false);
  });

  it("are not offered where they can't be put: without a way to react, only one's own lines are pressed, as before", () => {
    expect(count(lines({ onPick: () => {}, picked: 1 }), "chat-bubble")).toBe(1);
    expect(has(lines({ onPick: () => {}, picked: 1 }), "chat-react-bar")).toBe(false);
  });

  it("show none of the six as on when nothing is on", () => {
    const html = renderToStaticMarkup(createElement(ReactBar, { onReact: () => {} }));
    expect(count(html, "chat-react")).toBe(6);
    expect(html).not.toContain('aria-pressed="true"');
  });
});

describe("reacting on a TV that is only a remote", () => {
  const page = (parts: Partial<ChatLine> = {}) =>
    renderToStaticMarkup(createElement(ReactTv, { name: "Sam", line: with_(line(3, false, "Tonight at eight?"), parts), session: fakeSession(), onBack: () => {} }));

  it("is a page with the message quoted and the six as big buttons the remote walks, landing on the first", () => {
    const html = page();
    expect(html).toContain("React to Sam&#x27;s message");
    expect(tagOf(html, "tv-chat-react-quote")).toBeDefined();
    expect(html).toContain("Tonight at eight?");
    expect(count(html, "tv-chat-react")).toBe(CHAT_REACTIONS.length);
    expect(html.match(/data-testid="tv-chat-react"/g)).toHaveLength(6);
    expect(tagOf(html, "tv-chat-react")).toContain("data-nav");
    expect(tagOf(html, "tv-chat-react")).toContain("data-autofocus");
    expect(html.match(/data-autofocus/g)).toHaveLength(1);
    expect(has(html, "tv-chat-react-remove")).toBe(false);
    expect(has(html, "tv-chat-react-back")).toBe(true);
  });

  it("lands on the one that is on, and then offers to take it away", () => {
    const html = page({ myReaction: FIRE });
    expect(html).toMatch(new RegExp(`aria-pressed="true"[^>]*data-autofocus[^>]*data-reaction="${FIRE}"`));
    expect(html.match(/data-autofocus/g)).toHaveLength(1);
    expect(has(html, "tv-chat-react-remove")).toBe(true);
  });

  it("quotes a sticker or a GIF in words (a TV may have no colour emoji)", () => {
    expect(page({ text: "\u{1F37F}" })).toContain("A sticker \u{1F37F}");
    expect(page({ text: "https://static.klipy.com/ii/abc/def/sm/x.webp" })).not.toContain("static.klipy.com");
  });

  it("is about the friend's newest message", () => {
    expect(lastTheirs([line(1, false), line(2, true), line(3, false), line(4, true)])?.id).toBe(3);
    expect(lastTheirs([line(1, true)])).toBeUndefined();
  });
});

describe("the TV's chat and reactions", () => {
  const read = (props: Partial<Parameters<typeof ReadTv>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(ReadTv, { name: "Sam", session: fakeSession({ state: { lines: [line(1, false), line(2, true), line(3, false)] } }), report: fakeReport(), receiving: true, now: NOW, onWrite: () => {}, onClose: () => {}, onReactTo: () => {}, ...props }),
    );

  it("has 'React to Sam's last message' behind the ⋯, first in it, when there is one and one can write", () => {
    const html = read();
    const menu = html.slice(html.indexOf('data-testid="tv-chat-menu"'));
    expect(has(menu, "tv-chat-react-last")).toBe(true);
    expect(menu.indexOf("tv-chat-react-last")).toBeLessThan(menu.indexOf("tv-chat-takeback"));
    expect(tagOf(html, "tv-chat-react-last")).toContain("data-nav");
    expect(html).toContain("React to Sam&#x27;s last message");
    expect(has(read({ session: fakeSession({ state: { lines: [line(1, true)] } }) }), "tv-chat-react-last")).toBe(false);
    expect(has(read({ session: fakeSession({ state: { lines: [line(1, false)], open: false } }) }), "tv-chat-react-last")).toBe(false);
    expect(has(read({ session: fakeSession({ ended: "not_friends", state: { lines: [line(1, false)] } }) }), "tv-chat-react-last")).toBe(false);
  });

  it("lets a computer or a hand-held screen press a message, and a TV that is only a remote walk the list instead", () => {
    for (const screen of [{ desk: true }, { narrow: true }]) {
      const html = read(screen);
      expect(count(html, "chat-bubble"), JSON.stringify(screen)).toBe(3);
      expect(tagOf(html, "chat-bubble")).toContain('tabindex="-1"');
    }
    expect(count(read(), "chat-bubble")).toBe(0);
    expect(count(read({ desk: true, session: fakeSession({ state: { lines: [line(1, false), line(2, true)], open: false } }) }), "chat-bubble")).toBe(1);
  });
});
