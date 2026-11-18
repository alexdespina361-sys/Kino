import { z } from "zod";

/**
 * What a profile is told of the titles it watches (the owner, 18 Nov 2026: "notifications for series and anime that are not finished - a new episode
 * aired - plus new seasons and new films, for what the user watches or has finished"): a new episode or a new season of a show it has a card or a
 * rating of, and a new film of the series of films one it watched belongs to. The server looks (server/titleNotices): one line for each title, the
 * newest news of it, kept for a month; the bell lists them.
 */

/** How many a profile keeps, and for how long. */
export const TITLE_NOTICES_MAX = 30;
export const TITLE_NOTICE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** A title as the movie database numbers it, the way the names are asked for (shared/names.ts): `tv-1399`, `movie-603`. */
export const TITLE_NOTICE_ID = /^(tv|movie)-\d{1,10}$/;

export const TitleNoticeSchema = z.object({
  /** One line for each title: the show whose episode came out, or the film that did. */
  id: z.string().regex(TITLE_NOTICE_ID),
  at: z.number(),
  /** A new episode of the season the profile was told of last, the first of a new season, or a film. */
  what: z.enum(["episode", "season", "film"]),
  /** The name in English, as everything kept is (a screen shows it in its language: shared/names.ts). */
  title: z.string().max(300),
  /** The link of the title's page, as the library gives it. */
  url: z.string().max(2048),
  image: z.string().max(2048).optional(),
  backdrop: z.string().max(2048).optional(),
  year: z.number().int().optional(),
  /** The newest episode that is out. */
  season: z.number().int().min(1).max(200).optional(),
  episode: z.number().int().min(1).max(5000).optional(),
  /** How many episodes came out since the profile was told last, when more than one. */
  count: z.number().int().min(2).max(5000).optional(),
  /** For a film: the film of the same series that the profile watched. */
  like: z.string().max(300).optional(),
  read: z.boolean(),
});
export type TitleNotice = z.infer<typeof TitleNoticeSchema>;

/** (A server newer than the screen may tell of a kind the screen has never heard of: that one is left out, not the whole answer refused.) */
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
