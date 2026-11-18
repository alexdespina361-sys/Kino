import { z } from "zod";

export const PERSONAL_STICKER = {
  side: 192,
  sentBytes: 200_000,
  perProfile: 24,
  madePerDay: 20,
  picturesPerMinute: 600,
  uploadsAtOnce: 4,
  sitePerMinute: 120,
  siteWorkMsPerHour: 180_000,
  writesAtOnce: 8,
  siteMax: 3000,
  siteMegabytes: 200,
} as const;

export const PERSONAL_STICKER_BASE64_MAX = Math.ceil((PERSONAL_STICKER.sentBytes * 4) / 3) + 4;

export const MOVING_STICKER = {
  minFrames: 2,
  maxFrames: 48,
  minDelay: 20,
  maxDelay: 1000,
  maxDuration: 8000,
  sentBytes: 4_000_000,
  keptBytes: 600_000,
  triesPerDay: 40,
} as const;

export const MOVING_STICKER_BASE64_MAX = Math.ceil((MOVING_STICKER.sentBytes * 4) / 3) + 4;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const DELAYS = /^,"delays":\[(\d{1,4}(?:,\d{1,4})*)\]\}$/;
export function readStickerMake(text: string): { data: string; delays?: number[] } | undefined {
  const head = '{"data":"';
  if (!text.startsWith(head)) return undefined;
  const end = text.indexOf('"', head.length);
  if (end < 0) return undefined;
  const rest = text.slice(end + 1);
  if (rest.length > 16 + MOVING_STICKER.maxFrames * 5) return undefined;
  const data = text.slice(head.length, end);
  if (!BASE64.test(data)) return undefined;
  if (rest === "}") return { data };
  const delays = DELAYS.exec(rest)?.[1];
  return delays === undefined ? undefined : { data, delays: delays.split(",").map(Number) };
}

export const PERSONAL_STICKER_TEXT = "\u{1F5BC}\u{FE0F}";

export const StickerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
export const isStickerId = (value: unknown): value is string => StickerIdSchema.safeParse(value).success;

export const MyStickersSchema = z.object({
  stickers: z.array(z.object({ id: StickerIdSchema, mine: z.boolean() })).max(PERSONAL_STICKER.perProfile),
});
export type MyStickers = z.infer<typeof MyStickersSchema>;

export const StickerMakeSchema = z
  .object({
    data: z.string().max(MOVING_STICKER_BASE64_MAX),
    delays: z.array(z.number().int().min(MOVING_STICKER.minDelay).max(MOVING_STICKER.maxDelay)).min(MOVING_STICKER.minFrames).max(MOVING_STICKER.maxFrames).optional(),
  })
  .refine((made) => made.delays !== undefined || made.data.length <= PERSONAL_STICKER_BASE64_MAX);
export const StickerSendSchema = z.object({ id: StickerIdSchema, replyTo: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() });

export type StickerProblem = "not_a_picture" | "too_big" | "full" | "too_many" | "site_full" | "off";
