import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
