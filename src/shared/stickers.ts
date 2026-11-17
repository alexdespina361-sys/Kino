import { z } from "zod";

/**
 * Personal stickers (the owner's plan, 15 Nov 2026): a picture of one's own, made into a sticker on the page and sent in a chat like the built-in ones.
 * They are the first thing on this site that people put up themselves, so the rules are the server's, and narrow:
 *
 * - The page makes the picture a square PNG of `side` pixels (client/chat/personalStickers.ts). The server reads its size before anything else, unpacks it,
 *   and keeps a PNG it made itself from the pixels: nothing the sender wrote into the file is kept or sent on (server/accounts/stickerImage.ts).
 * - A profile has a collection of them: the ones it made and the ones it saved from a chat. A picture is kept while somebody has it; the last one to let it go
 *   (or a profile going) lets it go for good. A message of one keeps no hold on it: a picture nobody has any more is "no longer available" in the chat.
 * - A picture is shown to the profiles that have it, and in a chat to the two whose chat it was sent in (while they are friends): nobody else, however they ask.
 * - Children have none (a child's profile has no friends, so no chat).
 * - The host turns them on (env PERSONAL_STICKERS=on); off, nothing of them is offered, made, sent or shown, and what was made is kept. The team can take a
 *   picture down everywhere, or all of one profile's (scripts/stickers.mjs).
 */
export const PERSONAL_STICKER = {
  /** The side of the square the page makes, in pixels. */
  side: 192,
  /** The most a picture as sent may be, once decoded (a 192-pixel PNG of a photo is well under it). */
  sentBytes: 200_000,
  /** How many a profile may have (made and saved). */
  perProfile: 24,
  /** How many an account may make in a day. */
  madePerDay: 20,
  /** How many pictures an account may ask for in a minute (its collection's and its chats' together: a chat opening asks for many at once). */
  picturesPerMinute: 600,
  /** How many pictures are on their way to the server at once: one an account, so many for the whole site (each is held in memory until it is read). */
  uploadsAtOnce: 4,
  /** How many the whole site keeps, and how many megabytes (unless the host says another: env PERSONAL_STICKERS_MB). */
  siteMax: 3000,
  siteMegabytes: 200,
} as const;

/** The most the base64 of a picture may be: nothing longer is decoded. */
export const PERSONAL_STICKER_BASE64_MAX = Math.ceil((PERSONAL_STICKER.sentBytes * 4) / 3) + 4;

/**
 * Stickers that move (the owner's ask of 17 Nov 2026: WhatsApp's stickers and GIFs): while the host has them on as well (env MOVING_STICKERS=on), a picture that
 * moves (an animated WebP or GIF, or a short video such as WhatsApp keeps a GIF as) is made a sticker that moves, not only its first picture. The page sends its
 * pictures one under the other as one PNG (`side` wide, `side` times as many as there are high) and how long each is shown; the server reads it as it reads a
 * still one, and makes an animated WebP of its pixels (server/accounts/stickerImage.ts). Off, every picture is made of its first one, as before.
 */
export const MOVING_STICKER = {
  /** The fewest and the most pictures one has. */
  minFrames: 2,
  maxFrames: 48,
  /** How long a picture is shown, at the least and the most (ms), and how long all of them may be. */
  minDelay: 20,
  maxDelay: 1000,
  maxDuration: 8000,
  /** The most the pictures as sent may be (a PNG of photographs does not pack small), and the most what is kept may be. */
  sentBytes: 4_000_000,
  keptBytes: 600_000,
} as const;

export const MOVING_STICKER_BASE64_MAX = Math.ceil((MOVING_STICKER.sentBytes * 4) / 3) + 4;

/**
 * What a message that is a personal sticker says in words, wherever words are shown (the bell, the friends page, a page that is older than personal stickers,
 * a report): the framed-picture emoji. It is in no language, and it is not one of the built-in stickers (it would be drawn as one).
 */
export const PERSONAL_STICKER_TEXT = "\u{1F5BC}\u{FE0F}";

/** A personal sticker's name: 22 letters of base64url (128 random bits). */
export const StickerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
export const isStickerId = (value: unknown): value is string => StickerIdSchema.safeParse(value).success;

/** A profile's collection, the newest first. `mine`: it made the sticker (else it saved it from a chat). */
export const MyStickersSchema = z.object({
  stickers: z.array(z.object({ id: StickerIdSchema, mine: z.boolean() })).max(PERSONAL_STICKER.perProfile),
});
export type MyStickers = z.infer<typeof MyStickersSchema>;

/**
 * A picture made into a sticker on the page: a PNG, as base64. One that moves says how long each of its pictures is shown (`delays`, in ms), and may be bigger;
 * a still one is no bigger than a still one may be.
 */
export const StickerMakeSchema = z
  .object({
    data: z.string().max(MOVING_STICKER_BASE64_MAX),
    delays: z.array(z.number().int().min(MOVING_STICKER.minDelay).max(MOVING_STICKER.maxDelay)).min(MOVING_STICKER.minFrames).max(MOVING_STICKER.maxFrames).optional(),
  })
  .refine((made) => made.delays !== undefined || made.data.length <= PERSONAL_STICKER_BASE64_MAX);
/** Sending one of one's own in a chat, or saving one a friend sent. */
export const StickerSendSchema = z.object({ id: StickerIdSchema });

/** Why a sticker could not be made or kept. */
export type StickerProblem = "not_a_picture" | "too_big" | "full" | "too_many" | "site_full" | "off";
