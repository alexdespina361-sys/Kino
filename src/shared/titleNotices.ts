import { z } from "zod";

export const TITLE_NOTICES_MAX = 30;
export const TITLE_NOTICE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export const TITLE_NOTICE_ID = /^(tv|movie)-\d{1,10}$/;

export const TitleNoticeSchema = z.object({
  id: z.string().regex(TITLE_NOTICE_ID),
  at: z.number(),
  what: z.enum(["episode", "season", "film"]),
  title: z.string().max(300),
  url: z.string().max(2048),
  image: z.string().max(2048).optional(),
  backdrop: z.string().max(2048).optional(),
  year: z.number().int().optional(),
  season: z.number().int().min(1).max(200).optional(),
  episode: z.number().int().min(1).max(5000).optional(),
  count: z.number().int().min(2).max(5000).optional(),
  like: z.string().max(300).optional(),
  read: z.boolean(),
});
export type TitleNotice = z.infer<typeof TitleNoticeSchema>;

export const TitleNoticesSchema = z.object({
  items: z
    .array(z.unknown())
    .max(200)
    .transform((items) =>
      items.flatMap((item) => {
        const known = TitleNoticeSchema.safeParse(item);
        return known.success ? [known.data] : [];
      }),
    ),
});
export type TitleNotices = z.infer<typeof TitleNoticesSchema>;

export const TitleNoticeDismissSchema = z.object({ id: z.string().regex(TITLE_NOTICE_ID) });
export const TitleNoticeSeenSchema = z.object({ ids: z.array(z.string().regex(TITLE_NOTICE_ID)).max(TITLE_NOTICES_MAX).optional() });
