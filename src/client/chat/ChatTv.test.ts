import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { profileStore } from "../account/store";
import { ChatTv, ReadTv, ReportTv, WriteTv } from "./ChatTv";
import { count, fakeReport, fakeSession, has, line, tagOf } from "./fixtures";

const NOW = Date.UTC(2026, 9, 18, 15, 0);
const lines = [line(1, false), line(2, true), line(3, false)];

describe("the chat on the TV", () => {
  const read = (props: Partial<Parameters<typeof ReadTv>[0]> = {}) =>
    renderToStaticMarkup(createElement(ReadTv, { name: "Sam", session: fakeSession({ state: { lines } }), report: fakeReport(), receiving: true, now: NOW, onWrite: () => {}, onClose: () => {}, ...props }));

  it("is a page with the messages and five things to do: write, take back the last, mute, report, go back", () => {
    const html = read();
    for (const id of ["tv-chat", "tv-chat-lines", "tv-chat-write", "tv-chat-takeback", "tv-chat-mute", "tv-chat-report", "tv-chat-back"]) expect(has(html, id), id).toBe(true);
    expect(count(html, "chat-line")).toBe(3);
  });

  it("is one window: the friend at the top, and taking back, muting and reporting behind the ⋯, shut until it is opened", () => {
    const html = read({ avatar: "fox", online: true });
    expect(html).toContain('data-testid="tv-chat-name">Sam<');
    expect(has(html, "tv-chat-status")).toBe(true);
    expect(html).toContain("Online");
    expect(tagOf(html, "tv-chat-more")).toContain('aria-expanded="false"');
    expect(tagOf(html, "tv-chat-more")).toContain("data-nav");
    expect(tagOf(html, "tv-chat-menu")).toContain("hidden");
    // (what is in it is inside it, not a row of buttons beside the box)
    const menu = html.slice(html.indexOf('data-testid="tv-chat-menu"'));
    for (const id of ["tv-chat-takeback", "tv-chat-mute", "tv-chat-report"]) expect(has(menu, id), id).toBe(true);
    expect(read({ session: fakeSession({ state: { lines, muted: true } }) })).toContain("Muted");
  });

  it("has Search and the chat's GIFs and stickers behind the ⋯ where a message can be pressed, and not on a TV that is only a remote", () => {
    const menuOf = (html: string) => html.slice(html.indexOf('data-testid="tv-chat-menu"'));
    const pointer = menuOf(read({ desk: true, onMedia: () => {} }));
    for (const id of ["tv-chat-search-open", "tv-chat-media-open"]) expect(has(pointer, id), id).toBe(true);
    // (in its order: after taking back, before muting)
    expect(pointer.indexOf("tv-chat-takeback")).toBeLessThan(pointer.indexOf("tv-chat-search-open"));
    expect(pointer.indexOf("tv-chat-media-open")).toBeLessThan(pointer.indexOf("tv-chat-mute"));
    const remote = menuOf(read());
    for (const id of ["tv-chat-search-open", "tv-chat-media-open"]) expect(has(remote, id), id).toBe(false);
    // (the TV page as a whole: the gallery and the search come only with a pointer)
    const tv = (desk: boolean) => renderToStaticMarkup(createElement(ChatTv, { name: "Sam", session: fakeSession({ state: { lines } }), report: fakeReport(), desk, onClose: () => {}, now: NOW }));
    expect(has(tv(true), "tv-chat-media-open")).toBe(true);
    expect(has(tv(false), "tv-chat-media-open")).toBe(false);
  });

  it("shows a friend's GIF as the picture, and on a child's profile as a line of words, without asking KLIPY for it", () => {
    const gif = "https://static.klipy.com/ii/abc/def/sm/x.webp";
    const withGif = { session: fakeSession({ state: { lines: [line(1, false, gif)] } }) };
    expect(tagOf(read(withGif), "chat-gif")).toContain(`src="${gif}"`);
    profileStore.setSetting("child", true);
    try {
      const html = read(withGif);
      expect(has(html, "chat-gif")).toBe(false);
      expect(has(html, "chat-gif-child")).toBe(true);
      expect(html).not.toContain("static.klipy.com");
    } finally {
      profileStore.setSetting("child", undefined);
    }
  });

  it("shows a sticker's emoji sent alone as the sticker, on a child's profile too; words with the emoji in them stay words, and a report shows the emoji as it was sent", () => {
    const html = read({ session: fakeSession({ state: { lines: [line(1, false, "\u{1F37F}"), line(2, true, " \u{2764} "), line(3, false, "\u{1F37F} tonight?")] } }) });
    expect(count(html, "chat-sticker")).toBe(2);
    expect(tagOf(html, "chat-sticker")).toContain('src="/stickers/popcorn.webp"');
    expect(tagOf(html, "chat-sticker")).toContain('alt="\u{1F37F}"');
    expect(html).toContain('src="/stickers/heart.webp"');
    expect(html).toContain("\u{1F37F} tonight?");
    expect(html.split("chat-bubble chat-bubble-sticker").length - 1, "no bubble around them").toBe(2);
    profileStore.setSetting("child", true);
    try {
      expect(count(read({ session: fakeSession({ state: { lines: [line(1, false, "\u{1F37F}")] } }) }), "chat-sticker")).toBe(1);
    } finally {
      profileStore.setSetting("child", undefined);
    }
    const report = renderToStaticMarkup(createElement(ReportTv, { name: "Sam", report: fakeReport({ stage: "preview", preview: { rev: 1, lines: [line(1, false, "\u{1F37F}")] } }), now: NOW }));
    expect(has(report, "chat-sticker")).toBe(false);
    expect(report).toContain("\u{1F37F}");
  });

  it("has one button of what is sent besides words, the remote's stop before the box, on every screen, a TV that is only a remote too; the panel shut until it is pressed", () => {
    for (const screen of [{}, { desk: true }, { narrow: true }]) {
      for (const draft of ["", "See you at eight"]) {
        const html = read({ ...screen, draft, withPanel: true, gifKey: "key" });
        const what = `${JSON.stringify(screen)} ${JSON.stringify(draft)}`;
        expect(count(html, "tv-chat-panel-btn"), what).toBe(1);
        expect(tagOf(html, "tv-chat-panel-btn"), what).toContain("data-nav");
        expect(tagOf(html, "tv-chat-panel-btn"), what).toContain('aria-expanded="false"');
        // (Typed words change nothing: there is no + to fold into, and none of the three buttons it was.)
        for (const id of ["tv-chat-title-btn", "tv-chat-gif-btn", "tv-chat-sticker-btn", "tv-chat-tools", "tv-chat-panel"]) expect(has(html, id), `${what} ${id}`).toBe(false);
      }
    }
    expect(has(read(), "tv-chat-panel-btn")).toBe(false);
    // (a friend who takes no messages: nothing to send, no button)
    expect(has(read({ withPanel: true, session: fakeSession({ state: { lines, open: false } }) }), "tv-chat-panel-btn")).toBe(false);
  });

  it("is one bar on a computer and a hand-held screen: the button in it before the box, and Send beside it; a TV has it beside what opens the page that writes", () => {
    for (const screen of [{ desk: true }, { narrow: true }]) {
      const html = read({ ...screen, withPanel: true });
      const bar = html.slice(html.indexOf('data-testid="tv-chat-pill"'), html.indexOf('data-testid="tv-chat-box-send"'));
      for (const id of ["tv-chat-panel-btn", "tv-chat-box"]) expect(has(bar, id), `${JSON.stringify(screen)} ${id}`).toBe(true);
      expect(bar.indexOf('data-testid="tv-chat-panel-btn"'), "the button comes before the box").toBeLessThan(bar.indexOf('data-testid="tv-chat-box"'));
    }
    const tv = read({ withPanel: true });
    expect(has(tv, "tv-chat-pill")).toBe(false);
    expect(tv.indexOf('data-testid="tv-chat-panel-btn"')).toBeLessThan(tv.indexOf('data-testid="tv-chat-write"'));
  });

  it("on a TV, the box at the bottom opens the page that writes, and shows what was typed and not sent", () => {
    expect(read()).toContain("Write a message");
    expect(read({ draft: "See you at eight" })).toContain("See you at eight");
    expect(has(read(), "tv-chat-box")).toBe(false);
  });

  it("on a computer, the box is a box: the remote (the keyboard) starts in it, and Send waits for a message", () => {
    const html = read({ desk: true });
    expect(has(html, "tv-chat-write")).toBe(false);
    expect(tagOf(html, "tv-chat-box")).toContain("data-autofocus");
    expect(tagOf(html, "tv-chat-box")).toContain('maxLength="500"');
    expect(tagOf(html, "tv-chat-box-send")).toContain("disabled");
    expect(tagOf(read({ desk: true, draft: "Hello" }), "tv-chat-box-send")).not.toContain("disabled");
    expect(tagOf(read({ desk: true, draft: "Hello", session: fakeSession({ sending: true, state: { lines } }) }), "tv-chat-box-send")).toContain("disabled");
    // (a friend who takes no messages: no box, as no Write)
    expect(has(read({ desk: true, session: fakeSession({ state: { lines, open: false } }) }), "tv-chat-box")).toBe(false);
  });

  it("on a hand-held screen, the box is an editable area, not a form field (Chrome puts its form filler's strip over those), and does not take the keyboard by itself", () => {
    const html = read({ narrow: true });
    const tag = tagOf(html, "tv-chat-box")!;
    expect(tag).toMatch(/^<div/);
    expect(tag).toMatch(/contentEditable="(true|plaintext-only)"/);
    expect(tag).toContain('role="textbox"');
    expect(tag).toContain('enterKeyHint="send"');
    expect(tag).toContain('data-max-length="500"');
    expect(tag).toContain('data-placeholder="Write a message"');
    expect(tag).toContain("data-nav");
    expect(tag).not.toContain("data-autofocus");
    const form = html.slice(html.indexOf('data-testid="tv-chat-box-form"'));
    expect(form.slice(0, form.indexOf("</form>"))).not.toMatch(/<(input|textarea)\b/);
    expect(tagOf(read({ narrow: true, draft: "Hello" }), "tv-chat-box-send")).not.toContain("disabled");
    // (a computer keeps its plain box)
    expect(tagOf(read({ desk: true }), "tv-chat-box")).toMatch(/^<input/);
  });

  it("lands the remote on Write, and can be walked: every button and the list are `data-nav`", () => {
    const html = read();
    expect(tagOf(html, "tv-chat-write")).toContain("data-autofocus");
    for (const id of ["tv-chat-write", "tv-chat-takeback", "tv-chat-mute", "tv-chat-report", "tv-chat-back", "tv-chat-lines"]) expect(tagOf(html, id), id).toContain("data-nav");
  });

  it("offers to take back only when there is a message of one's own to take back", () => {
    expect(has(read({ session: fakeSession({ state: { lines: [line(1, false)] } }) }), "tv-chat-takeback")).toBe(false);
    expect(has(read({ session: fakeSession({ state: { lines: [] } }) }), "tv-chat-takeback")).toBe(false);
  });

  it("says, when there is nothing yet, that there is nothing, and what is kept and how", () => {
    const html = read({ session: fakeSession({ state: { lines: [] } }) });
    expect(has(html, "tv-chat-empty")).toBe(true);
    expect(has(html, "tv-chat-privacy")).toBe(true);
    expect(html).toContain("without encryption");
    expect(has(html, "tv-chat-lines")).toBe(false);
  });

  it("says that it is loading before the first answer", () => {
    expect(has(read({ session: fakeSession({ loaded: false }) }), "tv-chat-loading")).toBe(true);
  });

  it("has no Write when the friend is not taking messages or the friendship is over, and lands the remote on Back instead", () => {
    for (const session of [fakeSession({ state: { lines, open: false } }), fakeSession({ ended: "not_friends", state: { lines } })]) {
      const html = read({ session });
      expect(has(html, "tv-chat-write")).toBe(false);
      expect(has(html, "tv-chat-closed") || has(html, "tv-chat-ended")).toBe(true);
      expect(tagOf(html, "tv-chat-back")).toContain("data-autofocus");
    }
  });

  it("shows muting on the button and in a line, and what went wrong", () => {
    const html = read({ session: fakeSession({ problem: "offline", state: { lines, muted: true } }) });
    expect(tagOf(html, "tv-chat-mute")).toContain('aria-pressed="true"');
    expect(has(html, "tv-chat-muted")).toBe(true);
    expect(has(html, "tv-chat-problem")).toBe(true);
  });

  it("tells that the friend cannot answer when this profile takes no messages", () => {
    expect(has(read({ receiving: false }), "tv-chat-mine-off")).toBe(true);
    expect(has(read(), "tv-chat-mine-off")).toBe(false);
  });

  it("opens on the chat, and moves to a report once one was asked for", () => {
    const open = renderToStaticMarkup(createElement(ChatTv, { name: "Sam", session: fakeSession({ state: { lines } }), report: fakeReport(), onClose: () => {}, now: NOW }));
    expect(has(open, "tv-chat")).toBe(true);
    const reporting = renderToStaticMarkup(
      createElement(ChatTv, { name: "Sam", session: fakeSession({ state: { lines } }), report: fakeReport({ stage: "preview", preview: { rev: 3, lines } }), onClose: () => {}, now: NOW }),
    );
    expect(has(reporting, "tv-chat")).toBe(false);
    expect(has(reporting, "tv-chat-reporting")).toBe(true);
  });
});

describe("writing on the TV", () => {
  const write = (props: Partial<Parameters<typeof WriteTv>[0]> = {}) =>
    renderToStaticMarkup(createElement(WriteTv, { name: "Sam", session: fakeSession({ state: { lines } }), draft: "", setDraft: () => {}, narrow: false, onBack: () => {}, onSent: () => {}, ...props }));

  it("is a page with a box, the keys of the page, and Send and Back", () => {
    const html = write();
    for (const id of ["tv-chat-compose", "tv-chat-form", "tv-chat-input", "tv-chat-send", "tv-chat-cancel", "name-key-a", "name-key-z", "name-key-space", "name-key-delete", "name-key-clear", "name-key-!", "name-key-?"]) {
      expect(has(html, id), id).toBe(true);
    }
    expect(tagOf(html, "tv-chat-input")).toContain("data-nav");
    expect(tagOf(html, "tv-chat-input")).toContain('maxLength="500"');
  });

  it("has no keys on a hand-held screen, which types on its own", () => {
    const html = write({ narrow: true });
    expect(has(html, "tv-chat-input")).toBe(true);
    expect(has(html, "name-key-a")).toBe(false);
  });

  it("waits for a message before Send is possible", () => {
    expect(tagOf(write(), "tv-chat-send")).toContain("disabled");
    expect(tagOf(write({ draft: "   " }), "tv-chat-send")).toContain("disabled");
    expect(tagOf(write({ draft: "Hello" }), "tv-chat-send")).not.toContain("disabled");
    expect(tagOf(write({ draft: "Hello", session: fakeSession({ sending: true }) }), "tv-chat-send")).toContain("disabled");
  });

  it("shows the message to be answered, the last one of the chat", () => {
    expect(write().includes("message 3")).toBe(true);
    expect(has(write(), "tv-chat-quote")).toBe(true);
    expect(has(write({ session: fakeSession({ state: { lines: [] } }) }), "tv-chat-quote")).toBe(false);
  });

  it("shows what was typed", () => {
    expect(write({ draft: "See you at eight" })).toContain('value="See you at eight"');
  });
});

describe("the report on the TV", () => {
  const report = (parts: Parameters<typeof fakeReport>[0]) => renderToStaticMarkup(createElement(ReportTv, { name: "Sam", report: fakeReport(parts), now: NOW }));

  it("shows every message that would be sent, and the remote lands on Cancel, not on Send", () => {
    const html = report({ stage: "preview", preview: { rev: 3, lines } });
    expect(count(html, "chat-line")).toBe(3);
    expect(tagOf(html, "tv-chat-report-lines")).toContain("data-nav");
    expect(tagOf(html, "tv-chat-report-send")).not.toContain("disabled");
    expect(tagOf(html, "tv-chat-report-send")).not.toContain("data-autofocus");
    expect(tagOf(html, "tv-chat-report-cancel")).toContain("data-autofocus");
  });

  it("cannot send while the messages are fetched, when there are none, or when they could not be got", () => {
    expect(tagOf(report({ stage: "loading" }), "tv-chat-report-send")).toContain("disabled");
    const none = report({ stage: "preview", preview: { rev: 0, lines: [] } });
    expect(tagOf(none, "tv-chat-report-send")).toContain("disabled");
    expect(has(none, "tv-chat-report-none")).toBe(true);
    const failed = report({ stage: "preview", preview: null, problem: "offline" });
    expect(tagOf(failed, "tv-chat-report-send")).toContain("disabled");
    expect(has(failed, "tv-chat-report-problem")).toBe(true);
  });

  it("says it went, and only offers to be done, once it was sent", () => {
    const html = report({ stage: "sent", preview: { rev: 3, lines } });
    expect(has(html, "tv-chat-report-sent")).toBe(true);
    expect(has(html, "tv-chat-report-send")).toBe(false);
    expect(has(html, "tv-chat-report-cancel")).toBe(true);
  });
});
