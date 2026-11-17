import { z } from "zod";
import { plainText } from "./friends";

/**
 * A small chat between two friends: text, and a reaction from each of the two on a message (no groups, files, typing marks or read receipts; a GIF, a
 * sticker or a title is text that a screen draws as a picture). It is kept on the server, which is where its rules are kept too: who may write to whom,
 * how much, how often, and for how long a message stays. What is here is what both sides need to agree on.
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
/**
 * The reactions a message can have: each of the two can put one on any message (theirs or their own), change it or take it away. They are drawn with the
 * chat's stickers of the same emoji (client/chat/stickers.ts). How many changes of reactions one profile may make in a minute.
 */
export const CHAT_REACTIONS = ["\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F631}", "\u{1F62D}", "\u{1F44D}", "\u{1F525}"] as const;
/**
 * More of them, behind the "+" of the bar (the owner, 17 Nov: "allow more reaction options like that +"): the rest of the chat's own stickers that are a
 * face or a gesture, and the two of the cinema, each drawn with its sticker as the six are.
 */
export const CHAT_MORE_REACTIONS = [
  "\u{1F923}", // rolling on the floor laughing
  "\u{1F60D}", // heart eyes
  "\u{1F929}", // star-struck
  "\u{1F92F}", // mind blown
  "\u{1F914}", // thinking
  "\u{1F97A}", // pleading
  "\u{1F971}", // yawning
  "\u{1F634}", // sleeping
  "\u{1F44F}", // clapping
  "\u{1F389}", // party popper
  "\u{1F44B}", // waving
  "\u{1F47B}", // ghost
  "\u{1F480}", // skull
  "\u{1F440}", // eyes
  "\u{1F37F}", // popcorn
  "\u{1F3AC}", // clapper board
] as const;
/** Every reaction a message can have: the six of the bar first. */
export const CHAT_ALL_REACTIONS = [...CHAT_REACTIONS, ...CHAT_MORE_REACTIONS] as const;
export type ChatReaction = (typeof CHAT_ALL_REACTIONS)[number];
export const CHAT_REACTS_PER_MINUTE = 40;
export const isChatReaction = (value: unknown): value is ChatReaction => typeof value === "string" && (CHAT_ALL_REACTIONS as readonly string[]).includes(value);

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
  /** The reaction the one who looks put on it, and the friend's (one of `CHAT_REACTIONS`; a string, so that a page made before a new one came does not fail on it). */
  myReaction: z.string().max(16).optional(),
  theirReaction: z.string().max(16).optional(),
  /**
   * A personal sticker (shared/stickers.ts): its name, the picture being asked for from the chat's own address. The text is then `PERSONAL_STICKER_TEXT`,
   * which is what every place that shows words shows. (A string here, so that a page is not failed by a line it cannot show: it shows the text.)
   */
  sticker: z.string().max(64).optional(),
  /**
   * The message this one answers (the owner, 17 Nov: "dragging a message makes it reply to it"): its `id`, and nothing of what it said. The page finds it among
   * the lines; one that is not there any more (taken back, or let go) is quoted as gone, so that nothing taken back lives on in a quote.
   */
  replyTo: z.number().int().nonnegative().optional(),
});
export type ChatLine = z.infer<typeof ChatLineSchema>;

/** A message's reactions as they are now (none of one: taken away), in an answer that says only what changed (`ChatThread.reactions`). */
export const ChatReactionsNowSchema = ChatLineSchema.pick({ id: true, myReaction: true, theirReaction: true });
export type ChatReactionsNow = z.infer<typeof ChatReactionsNowSchema>;

/**
 * A chat, as one of the two sees it. `rev` goes up with every change to the messages (a new one, one taken back, one let go, a reaction): a screen that
 * sends the `rev` it has is answered without `lines` when nothing changed, so asking every few seconds costs a few bytes. A screen that says it can take
 * it (`reactions=1`) is answered, when only reactions changed since its `rev`, with `reactions` instead: those messages whose reactions changed, as they
 * are now. `open` is whether the friend takes messages now (when they do not, nothing can be sent, and the page says so); `muted` is whether this profile
 * muted the friend.
 */
export const ChatThreadSchema = z.object({
  rev: z.number().int().nonnegative(),
  open: z.boolean(),
  muted: z.boolean(),
  lines: z.array(ChatLineSchema).max(CHAT_KEEP_MAX).optional(),
  reactions: z.array(ChatReactionsNowSchema).max(CHAT_KEEP_MAX).optional(),
});
export type ChatThread = z.infer<typeof ChatThreadSchema>;

/** The message something answers, when it does (`ChatLine.replyTo`): one that is not in the chat when it is sent is not quoted, and the message goes all the same. */
export const ChatReplyToSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** What is written to a friend. (The text is cleaned and measured by the server, whatever the page did.) */
export const ChatSendSchema = z.object({ text: z.string().max(CHAT_TEXT_MAX * 4), replyTo: ChatReplyToSchema.optional() });
export const ChatMuteSchema = z.object({ muted: z.boolean() });
export type ChatMute = z.infer<typeof ChatMuteSchema>;
/** A reaction put on a message, or taken away (null). */
export const ChatReactSchema = z.object({ reaction: z.enum(CHAT_ALL_REACTIONS).nullable() });

/**
 * What a report would send, before anybody has agreed to send it: the last messages of the chat, as they stand at `rev`. Sending is asked for
 * with that `rev`, and is refused if the chat has changed since, so what was shown is what goes. (Its `rev` is that of what was said: a reaction
 * does not move it, so the one reported cannot hold a report off by putting reactions on and off; and a report holds the words, not the reactions.)
 */
export const ChatReportPreviewSchema = z.object({ rev: z.number().int().nonnegative(), lines: z.array(ChatLineSchema).max(CHAT_REPORT_LINES) });
export type ChatReportPreview = z.infer<typeof ChatReportPreviewSchema>;
export const ChatReportSchema = z.object({ rev: z.number().int().nonnegative() });

// (What waits in a chat, a friend at a time - `ChatNotice` - is told with the friends, so it is in friends.ts: this file needs that one, not the other way round.)
