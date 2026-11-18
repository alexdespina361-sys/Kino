import { z } from "zod";

/**
 * A title's name and description in the viewer's language (the owner, 18 Nov: "on Romanian, movies and films and cartoons have the Romanian name
 * instead of English always"). The library's own `title` stays the English one everywhere: what is kept (progress, lists, ratings) and what is
 * matched goes by it. The name in the viewer's language is asked for apart (`GET /api/library/names`), by the movie database's id, and shown
 * over the English one where a title is shown; a title the movie database has no name for in that language keeps its English one.
 */

/** The languages a name is looked up in (the site's own, but English: that is what the library is in), and what the movie database calls each. */
export const NAME_LANGUAGES = { ro: "ro-RO", it: "it-IT" } as const;
export type NameLanguage = keyof typeof NAME_LANGUAGES;
export const isNameLanguage = (lang: string): lang is NameLanguage => Object.hasOwn(NAME_LANGUAGES, lang);

/** How many titles one question may be about. */
export const NAMES_AT_ONCE = 40;

/** A title for a question about names: `movie-603`, `tv-1399` (the movie database's kind and id). */
export const NAME_ID = /^(movie|tv)-(\d{1,10})$/;

export const LocalNameSchema = z.object({
  /** The name in the language asked for; none when there is none (the English one is shown). */
  title: z.string().max(300).optional(),
  /** The description in that language; none when there is none. */
  description: z.string().max(400).optional(),
});
export type LocalName = z.infer<typeof LocalNameSchema>;

/** The answer: every title that could be asked about has an entry (an empty one for "nothing in this language"); one missing was not reached just now. */
export const NamesAnswerSchema = z.object({ names: z.record(z.string(), LocalNameSchema) });
export type NamesAnswer = z.infer<typeof NamesAnswerSchema>;

/**
 * What a title is asked about as, from its tile's id (`filmpire-tv-1399`) or, for one that was kept (progress, a list, a card in a chat) and has only
 * the link that plays it, from that link: a show's link says its season and episode, a film's does not. Null for a title that is not the movie database's.
 */
export function nameIdOf(item: { id?: string | undefined; url?: string | undefined }): string | null {
  const byId = /^filmpire-(movie|tv)-(\d{1,10})$/.exec(item.id ?? "");
  if (byId) return `${byId[1]}-${byId[2]}`;
  if (!item.url) return null;
  try {
    const url = new URL(item.url);
    const match = /^\/watch\/(\d{1,10})$/.exec(url.pathname);
    if (!match || !/(^|\.)filmpire\.(sc|cc)$/i.test(url.hostname)) return null;
    const type = url.searchParams.get("type");
    const show = url.searchParams.has("s") || url.searchParams.has("e") || type === "series" || type === "tv";
    return `${show ? "tv" : "movie"}-${match[1]}`;
  } catch {
    return null;
  }
}
