import { z } from "zod";
import { plainText } from "./friends";

/**
 * A small chat between two friends: text and nothing else (no groups, pictures, files, reactions, typing marks or read receipts). It is kept on the
 * server, which is where its rules are kept too: who may write to whom, how much, how often, and for how long a message stays. What is here is what
 * both sides need to agree on.
 *
 * Messages are stored as they were written, made fit to show (see `plainText`), not encrypted: whoever runs the server could read them. They are
 * never shown as links and never as anything but text.
 */

/** The most a message may say, once it is made fit to show. */
export const CHAT_TEXT_MAX = 500;
/** A pair keeps only the newest messages, and only this long. */
export const CHAT_KEEP_MAX = 200;
export const CHAT_KEEP_MS = 30 * 24 * 3600 * 1000;
/** How many messages one sender may send in a minute. */
export const CHAT_SENDS_PER_MINUTE = 20;
/** A report to the team holds the last of the messages: this many. */
export const CHAT_REPORT_LINES = 20;
/** While a chat is open its screen asks what is new this often. */
export const CHAT_POLL_MS = 3000;

export type ChatTextProblem = "empty" | "too_long";

/** What somebody wrote, made fit to show: one paragraph without control or direction characters, trimmed. Or what is wrong with it. */
export function checkChatText(raw: string): { ok: true; text: string } | { ok: false; error: ChatTextProblem } {
  const text = plainText(raw);
  if (!text) return { ok: false, error: "empty" };
  return text.length > CHAT_TEXT_MAX ? { ok: false, error: "too_long" } : { ok: true, text };
}

/** One message as the one who looks at the chat sees it. */
export const ChatLineSchema = z.object({
  /** Names the message in its chat (the number the chat was at when the message was sent). */
  id: z.number().int().nonnegative(),
  at: z.number(),
  /** The one who looks is the one who wrote it. */
  mine: z.boolean(),
  text: z.string().max(CHAT_TEXT_MAX),
});
export type ChatLine = z.infer<typeof ChatLineSchema>;

/**
 * A chat, as one of the two sees it. `rev` goes up with every change to the messages (a new one, one taken back, one let go): a screen that
 * sends the `rev` it has is answered without `lines` when nothing changed, so asking every few seconds costs a few bytes. `open` is whether the
 * friend takes messages now (when they do not, nothing can be sent, and the page says so); `muted` is whether this profile muted the friend.
 */
export const ChatThreadSchema = z.object({
  rev: z.number().int().nonnegative(),
  open: z.boolean(),
  muted: z.boolean(),
  lines: z.array(ChatLineSchema).max(CHAT_KEEP_MAX).optional(),
});
export type ChatThread = z.infer<typeof ChatThreadSchema>;

/** What is written to a friend. (The text is cleaned and measured by the server, whatever the page did.) */
export const ChatSendSchema = z.object({ text: z.string().max(CHAT_TEXT_MAX * 4) });
export const ChatMuteSchema = z.object({ muted: z.boolean() });
export type ChatMute = z.infer<typeof ChatMuteSchema>;

/**
 * What a report would send, before anybody has agreed to send it: the last messages of the chat, as they stand at `rev`. Sending is asked for
 * with that `rev`, and is refused if the chat has changed since, so what was shown is what goes.
 */
export const ChatReportPreviewSchema = z.object({ rev: z.number().int().nonnegative(), lines: z.array(ChatLineSchema).max(CHAT_REPORT_LINES) });
export type ChatReportPreview = z.infer<typeof ChatReportPreviewSchema>;
export const ChatReportSchema = z.object({ rev: z.number().int().nonnegative() });

/** Messages waiting from a friend (that were not looked at, and that are not muted): what the friends page and the bell tell. */
export interface ChatNotice {
  friend: string;
  count: number;
  /** When the newest of them was sent. */
  at: number;
}
