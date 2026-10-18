import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatPhone, ChatReportSheet } from "./ChatPhone";
import { count, fakeReport, fakeSession, has, line, tagOf } from "./fixtures";

const NOW = Date.UTC(2026, 9, 18, 15, 0);
const lines = [line(1, false), line(2, true), line(3, false)];
const render = (props: Partial<Parameters<typeof ChatPhone>[0]> = {}) =>
  renderToStaticMarkup(createElement(ChatPhone, { name: "Sam", session: fakeSession({ state: { lines } }), report: fakeReport(), onClose: () => {}, now: NOW, ...props }));

describe("the chat on the phone", () => {
  it("is a sheet with the messages, a box to write in and a button to send, and Mute and Report", () => {
    const html = render();
    for (const id of ["chat-sheet", "chat", "chat-lines", "chat-compose", "chat-input", "chat-send", "chat-mute", "chat-report"]) expect(has(html, id), id).toBe(true);
    expect(count(html, "chat-line")).toBe(3);
    expect(has(html, "chat-empty")).toBe(false);
    expect(has(html, "chat-closed")).toBe(false);
  });

  it("cannot send nothing: the button waits for a message, and for the last one to be on its way", () => {
    expect(tagOf(render(), "chat-send")).toContain("disabled");
    expect(tagOf(render({ session: fakeSession({ sending: true, state: { lines } }) }), "chat-send")).toContain("disabled");
  });

  it("limits the box to what the server keeps, and asks the phone to send on Enter", () => {
    const tag = tagOf(render(), "chat-input")!;
    expect(tag).toContain('maxLength="500"');
    expect(tag).toContain('enterKeyHint="send"');
    expect(tag).toContain('autoComplete="off"');
  });

  it("says that it is loading, not that it is empty, before the first answer", () => {
    const html = render({ session: fakeSession({ loaded: false }) });
    expect(has(html, "chat-loading")).toBe(true);
    expect(has(html, "chat-empty")).toBe(false);
  });

  it("says, when there is nothing yet, that there is nothing, and what is kept and how", () => {
    const html = render({ session: fakeSession({ state: { lines: [] } }) });
    expect(has(html, "chat-empty")).toBe(true);
    expect(has(html, "chat-privacy")).toBe(true);
    expect(html).toContain("200 messages"); // (in English: the line is the server's numbers, said)
    expect(html).toContain("30 days");
    expect(html).toContain("without encryption");
    expect(has(html, "chat-compose")).toBe(true);
  });

  it("gives way to a line when the friend is not taking messages: nothing to write in", () => {
    const html = render({ session: fakeSession({ state: { lines, open: false } }) });
    expect(has(html, "chat-closed")).toBe(true);
    expect(has(html, "chat-compose")).toBe(false);
    expect(has(html, "chat-lines")).toBe(true); // (what was said before can still be read)
  });

  it("does not claim the friend is not taking messages before it knows", () => {
    const html = render({ session: fakeSession({ loaded: false, state: { open: false } }) });
    expect(has(html, "chat-closed")).toBe(false);
  });

  it("gives way to a line when the friendship is over, or friends are off", () => {
    for (const ended of ["not_friends", "friends_off"] as const) {
      const html = render({ session: fakeSession({ ended, state: { lines } }) });
      expect(has(html, "chat-ended"), ended).toBe(true);
      expect(has(html, "chat-compose"), ended).toBe(false);
    }
  });

  it("says quietly what went wrong, over the box that stays", () => {
    const html = render({ session: fakeSession({ problem: "rate_limited", state: { lines } }) });
    expect(has(html, "chat-problem")).toBe(true);
    expect(has(html, "chat-compose")).toBe(true);
    expect(has(render(), "chat-problem")).toBe(false);
  });

  it("shows that the friend is muted, on the button and in a line", () => {
    const html = render({ session: fakeSession({ state: { lines, muted: true } }) });
    expect(tagOf(html, "chat-mute")).toContain('aria-pressed="true"');
    expect(has(html, "chat-muted")).toBe(true);
    expect(tagOf(render(), "chat-mute")).toContain('aria-pressed="false"');
    expect(has(render(), "chat-muted")).toBe(false);
  });

  it("tells that the friend cannot answer when this profile takes no messages", () => {
    expect(has(render({ receiving: false }), "chat-mine-off")).toBe(true);
    expect(has(render(), "chat-mine-off")).toBe(false);
    expect(has(render({ receiving: false }), "chat-compose")).toBe(true); // (it can still write)
  });

  it("lets a message of one's own be pressed", () => {
    expect(count(render(), "chat-bubble")).toBe(1);
  });

  it("opens no report by itself", () => {
    expect(has(render(), "chat-report-sheet")).toBe(false);
  });

  it("shows the report over the chat once it was asked for", () => {
    const html = render({ report: fakeReport({ stage: "preview", preview: { rev: 3, lines } }) });
    expect(has(html, "chat-sheet")).toBe(true);
    expect(has(html, "chat-report-sheet")).toBe(true);
  });
});

describe("the report on the phone", () => {
  const sheet = (report: ReturnType<typeof fakeReport>) => renderToStaticMarkup(createElement(ChatReportSheet, { name: "Sam", report, now: NOW }));

  it("shows every message that would be sent, with whose it is, and a button that sends them", () => {
    const html = sheet(fakeReport({ stage: "preview", preview: { rev: 3, lines } }));
    expect(count(html, "chat-line")).toBe(3);
    expect(html).toContain("chat-writer");
    expect(tagOf(html, "chat-report-send")).not.toContain("disabled");
  });

  it("sends nothing before the button: it is not enabled while the messages are fetched, or when there are none", () => {
    expect(tagOf(sheet(fakeReport({ stage: "loading" })), "chat-report-send")).toContain("disabled");
    expect(has(sheet(fakeReport({ stage: "loading" })), "chat-report-loading")).toBe(true);
    const none = sheet(fakeReport({ stage: "preview", preview: { rev: 0, lines: [] } }));
    expect(tagOf(none, "chat-report-send")).toContain("disabled");
    expect(has(none, "chat-report-none")).toBe(true);
    expect(tagOf(sheet(fakeReport({ stage: "sending", preview: { rev: 3, lines } })), "chat-report-send")).toContain("disabled");
  });

  it("says when it could not get the messages, and has nothing to send", () => {
    const html = sheet(fakeReport({ stage: "preview", preview: null, problem: "offline" }));
    expect(has(html, "chat-report-problem")).toBe(true);
    expect(tagOf(html, "chat-report-send")).toContain("disabled");
  });

  it("says when the chat changed while it was shown, and shows it again", () => {
    const html = sheet(fakeReport({ stage: "preview", preview: { rev: 4, lines }, problem: "changed" }));
    expect(has(html, "chat-report-problem")).toBe(true);
    expect(tagOf(html, "chat-report-send")).not.toContain("disabled");
  });

  it("says it went, and offers to be done, once it was sent", () => {
    const html = sheet(fakeReport({ stage: "sent", preview: { rev: 3, lines } }));
    expect(has(html, "chat-report-sent")).toBe(true);
    expect(has(html, "chat-report-done")).toBe(true);
    expect(has(html, "chat-report-send")).toBe(false);
    expect(has(html, "chat-lines")).toBe(false);
  });
});
