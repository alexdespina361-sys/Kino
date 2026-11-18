import { z } from "zod";
import { plainText } from "./friends";
import { looksLikeGifButIsNot } from "./gifs";

export const CHAT_TEXT_MAX = 500;
export const CHAT_KEEP_MAX = 200;
export const CHAT_KEEP_MS = 30 * 24 * 3600 * 1000;
export const CHAT_SENDS_PER_MINUTE = 20;
export const CHAT_REPORT_LINES = 20;
export const CHAT_POLL_MS = 3000;
export const CHAT_REACTIONS = ["\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F631}", "\u{1F62D}", "\u{1F44D}", "\u{1F525}"] as const;
export const CHAT_MORE_REACTIONS = [
  "\u{1F923}",
  "\u{1F60D}",
  "\u{1F929}",
  "\u{1F92F}",
  "\u{1F914}",
  "\u{1F97A}",
  "\u{1F971}",
  "\u{1F634}",
  "\u{1F44F}",
  "\u{1F389}",
  "\u{1F44B}",
  "\u{1F47B}",
  "\u{1F480}",
  "\u{1F440}",
  "\u{1F37F}",
  "\u{1F3AC}",
] as const;
export const CHAT_ALL_REACTIONS = [...CHAT_REACTIONS, ...CHAT_MORE_REACTIONS] as const;
export type ChatReaction = (typeof CHAT_ALL_REACTIONS)[number];
export const CHAT_REACTS_PER_MINUTE = 40;
export const isChatReaction = (value: unknown): value is ChatReaction => typeof value === "string" && (CHAT_ALL_REACTIONS as readonly string[]).includes(value);

export type ChatTextProblem = "empty" | "too_long" | "not_a_picture";

export function checkChatText(raw: string): { ok: true; text: string } | { ok: false; error: ChatTextProblem } {
  const text = plainText(raw);
  if (!text) return { ok: false, error: "empty" };
  if (text.length > CHAT_TEXT_MAX) return { ok: false, error: "too_long" };
  return looksLikeGifButIsNot(text) ? { ok: false, error: "not_a_picture" } : { ok: true, text };
}

export const ChatLineSchema = z.object({
  id: z.number().int().nonnegative(),
  at: z.number(),
  mine: z.boolean(),
  text: z.string().max(CHAT_TEXT_MAX),
  myReaction: z.string().max(16).optional(),
  theirReaction: z.string().max(16).optional(),
  sticker: z.string().max(64).optional(),
  replyTo: z.number().int().nonnegative().optional(),
});
export type ChatLine = z.infer<typeof ChatLineSchema>;

export const ChatReactionsNowSchema = ChatLineSchema.pick({ id: true, myReaction: true, theirReaction: true });
export type ChatReactionsNow = z.infer<typeof ChatReactionsNowSchema>;

export const ChatThreadSchema = z.object({
  rev: z.number().int().nonnegative(),
  open: z.boolean(),
  muted: z.boolean(),
  theirSeen: z.number().int().nonnegative().optional(),
  theirGot: z.number().int().nonnegative().optional(),
  lines: z.array(ChatLineSchema).max(CHAT_KEEP_MAX).optional(),
  reactions: z.array(ChatReactionsNowSchema).max(CHAT_KEEP_MAX).optional(),
});
export type ChatThread = z.infer<typeof ChatThreadSchema>;

export const ChatReplyToSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const ChatSendSchema = z.object({ text: z.string().max(CHAT_TEXT_MAX * 4), replyTo: ChatReplyToSchema.optional() });
export const ChatMuteSchema = z.object({ muted: z.boolean() });
export type ChatMute = z.infer<typeof ChatMuteSchema>;
export const ChatReactSchema = z.object({ reaction: z.enum(CHAT_ALL_REACTIONS).nullable() });

export const ChatReportPreviewSchema = z.object({ rev: z.number().int().nonnegative(), lines: z.array(ChatLineSchema).max(CHAT_REPORT_LINES) });
export type ChatReportPreview = z.infer<typeof ChatReportPreviewSchema>;
export const ChatReportSchema = z.object({ rev: z.number().int().nonnegative() });

