import { randomBytes } from "node:crypto";
import type { ChatReport, ChatReporter } from "../accounts/chatRoutes";
import { readWords } from "./intake";
import type { FeedbackStore } from "./store";

const stamp = (at: number) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/**
 * The messages of a reported chat as the team reads them: who reported whom and when, then each message with its time and who wrote it. The
 * names are the ones friends see (one line each) and a message is one line of plain text, so no message can pass for a line of another.
 */
export function chatTranscript(report: ChatReport): string {
  const who = (from: "reporter" | "about") => (from === "reporter" ? report.reporter.label : report.about.label);
  return [
    "A chat between two friends, reported by one of them.",
    `Reported by: ${report.reporter.label} (profile ${report.reporter.id})`,
    `About: ${report.about.label} (profile ${report.about.id})`,
    `Reported at: ${stamp(report.at)}`,
    `The last ${report.lines.length} messages of the chat, oldest first, as the reporter was shown them before they agreed to send them:`,
    "",
    ...report.lines.map((line) => `[${stamp(line.at)}] ${who(line.from)}: ${line.text}`),
    "",
  ].join("\n");
}

/**
 * Reports go to the team the way feedback does (see shared/reports.ts): a problem about the friends, with the messages in a file of its own, so that
 * the team reads the part of a chat that somebody chose to send and never browses chats. A report from a chat is not answered in the app (it is
 * not tied to an account, and the one who is reported must never be found by it).
 */
export function chatReporter(feedback: FeedbackStore): ChatReporter {
  return async (report) => {
    const { title, message } = readWords({
      title: `Chat reported: ${report.reporter.label} about ${report.about.label}`,
      message: `${report.reporter.label} reported their chat with ${report.about.label}. The last ${report.lines.length} messages are in chat.txt.`,
    });
    await feedback.create({
      key: randomBytes(18).toString("base64url"),
      kind: "bug",
      area: "friends",
      title,
      message,
      details: {},
      answer: false,
      context: null,
      files: [{ meta: { id: "chat", name: "chat.txt", mime: "text/plain", role: "file" }, data: Buffer.from(chatTranscript(report), "utf8") }],
    });
  };
}
