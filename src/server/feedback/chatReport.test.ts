import { describe, expect, it } from "vitest";
import type { ChatReport } from "../accounts/chatRoutes";
import { chatReporter, chatTranscript } from "./chatReport";
import { FeedbackStore, MemoryFeedbackBackend, type NewReport } from "./store";

const quiet = { warn: () => {} };

const report: ChatReport = {
  reporter: { id: "pro_alex", label: "Alex#1" },
  about: { id: "pro_sam", label: "Sam#2" },
  at: Date.UTC(2026, 9, 18, 14, 5, 30),
  lines: [
    { at: Date.UTC(2026, 9, 18, 14, 1, 2), from: "about", text: "something awful" },
    { at: Date.UTC(2026, 9, 18, 14, 3, 59), from: "reporter", text: "stop it" },
  ],
};

describe("the transcript of a reported chat", () => {
  it("says who reported whom and when, and then each message with its time and its writer, oldest first", () => {
    expect(chatTranscript(report).split("\n")).toEqual([
      "A chat between two friends, reported by one of them.",
      "Reported by: Alex#1 (profile pro_alex)",
      "About: Sam#2 (profile pro_sam)",
      "Reported at: 2026-10-18 14:05 UTC",
      "The last 2 messages of the chat, oldest first, as the reporter was shown them before they agreed to send them:",
      "",
      "[2026-10-18 14:01 UTC] Sam#2: something awful",
      "[2026-10-18 14:03 UTC] Alex#1: stop it",
      "",
    ]);
  });
});

describe("reporting a chat to the team", () => {
  it("is a problem about the friends, not answered in the app, with the messages in a file of their own", async () => {
    const feedback = await FeedbackStore.open({ backend: new MemoryFeedbackBackend() });
    await chatReporter(feedback)(report);
    expect(feedback.size).toBe(1);
    const record = feedback.get("1")!;
    expect(record).toMatchObject({ kind: "bug", area: "friends", status: "new", answer: false, title: "Chat reported: Alex#1 about Sam#2" });
    expect(record.accountId).toBeUndefined(); // (it is not tied to an account, and so cannot lead to the one who was reported)
    expect(record.message).toBe("Alex#1 reported their chat with Sam#2. The last 2 messages are in chat.txt.");
    expect(record.files).toMatchObject([{ id: "chat", name: "chat.txt", mime: "text/plain", role: "file" }]);
    const file = await feedback.file("1", "chat");
    expect(file?.data.toString("utf8")).toBe(chatTranscript(report));
  });

  it("is one report for each time, and is found by the team like the others", async () => {
    const feedback = await FeedbackStore.open({ backend: new MemoryFeedbackBackend() });
    const send = chatReporter(feedback);
    await send(report);
    await send(report);
    expect(feedback.size).toBe(2);
    expect(feedback.list({ area: "friends", kind: "bug" })).toHaveLength(2);
    expect(feedback.list({ q: "Sam#2" })).toHaveLength(2);
  });

  it("says it is full, and keeps nothing, when the team's side holds as many reports as it may and none of them is closed", async () => {
    const feedback = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), maxReports: 1, log: quiet });
    const open: NewReport = { key: "k".repeat(22), kind: "bug", area: "player", title: "Open", message: "It broke", details: {}, answer: true, context: null, files: [] };
    await feedback.create(open);
    expect(await chatReporter(feedback)(report)).toBe("full");
    expect(feedback.list().map((each) => each.title)).toEqual(["Open"]);

    await feedback.update("1", (draft) => void (draft.status = "done"));
    expect(await chatReporter(feedback)(report)).toBeUndefined();
    expect(feedback.list().map((each) => each.area)).toEqual(["friends"]);
  });

  it("does not keep a report without its messages: when they do not fit it is turned away, though its words would fit", async () => {
    const messages = Buffer.byteLength(chatTranscript(report), "utf8");
    // Room for the words of one report, and for its messages but a byte.
    const short = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), maxBytes: 6 * 1024 + messages - 1, log: quiet });
    expect(await chatReporter(short)(report)).toBe("full");
    expect(short.size).toBe(0);

    const enough = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), maxBytes: 6 * 1024 + messages, log: quiet });
    expect(await chatReporter(enough)(report)).toBeUndefined();
    expect((await enough.file("1", "chat"))?.data.toString("utf8")).toBe(chatTranscript(report));
  });
});
