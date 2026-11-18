import { randomBytes } from "node:crypto";
import type { ChatReport, ChatReporter } from "../accounts/chatRoutes";
import { pictureType } from "../accounts/stickerImage";
import { readWords } from "./intake";
import { FeedbackFull, TooManyOpen, type FeedbackStore } from "./store";

export const CHAT_REPORTS_OPEN = 3;

const stamp = (at: number) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function chatTranscript(report: ChatReport): string {
  const who = (from: "reporter" | "about") => (from === "reporter" ? report.reporter.label : report.about.label);
  const pictures = pictureNames(report);
  const said = (line: ChatReport["lines"][number]) =>
    line.sticker ? `${line.text} [personal sticker ${line.sticker}: ${pictures.get(line.sticker) ? `picture in ${pictures.get(line.sticker)}` : "picture not in this report"}]` : line.text;
  return [
    "A chat between two friends, reported by one of them.",
    `Reported by: ${report.reporter.label} (profile ${report.reporter.id})`,
    `About: ${report.about.label} (profile ${report.about.id})`,
    `Reported at: ${stamp(report.at)}`,
    `The last ${report.lines.length} messages of the chat, oldest first, as the reporter was shown them before they agreed to send them:`,
    "",
    ...report.lines.map((line) => `[${stamp(line.at)}] ${who(line.from)}: ${said(line)}`),
    "",
    ...(pictures.size > 0 ? ["A personal sticker is taken down everywhere with: node scripts/stickers.mjs remove <its name> --yes", ""] : []),
  ].join("\n");
}

const pictureName = (data: Buffer, at: number) => `sticker${at + 1}.${pictureType(data) === "image/webp" ? "webp" : "png"}`;
function pictureNames(report: ChatReport): Map<string, string> {
  return new Map((report.pictures ?? []).map((picture, at) => [picture.sticker, pictureName(picture.data, at)]));
}

export function chatReporter(feedback: FeedbackStore): ChatReporter {
  return async (report) => {
    const { title, message } = readWords({
      title: `Chat reported: ${report.reporter.label} about ${report.about.label}`,
      message: `${report.reporter.label} reported their chat with ${report.about.label}. The last ${report.lines.length} messages are in chat.txt.`,
    });
    try {
      await feedback.create(
        {
          key: randomBytes(18).toString("base64url"),
          kind: "bug",
          area: "friends",
          title,
          message,
          details: {},
          answer: false,
          context: null,
          files: [
            { meta: { id: "chat", name: "chat.txt", mime: "text/plain", role: "file" }, data: Buffer.from(chatTranscript(report), "utf8") },
            ...(report.pictures ?? []).map((picture, at) => ({
              meta: { id: `sticker${at + 1}`, name: pictureName(picture.data, at), mime: pictureType(picture.data), role: "photo" as const },
              data: picture.data,
            })),
          ],
          from: `chat:${report.account}`,
        },
        { maxOpen: CHAT_REPORTS_OPEN },
      );
    } catch (error) {
      if (error instanceof FeedbackFull) return "full";
      if (error instanceof TooManyOpen) return "too_many_open";
      throw error;
    }
  };
}
