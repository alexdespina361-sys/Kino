import { z } from "zod";

export const NAME_LANGUAGES = { ro: "ro-RO", it: "it-IT" } as const;
export type NameLanguage = keyof typeof NAME_LANGUAGES;
export const isNameLanguage = (lang: string): lang is NameLanguage => Object.hasOwn(NAME_LANGUAGES, lang);

export const NAMES_AT_ONCE = 40;

export const NAME_ID = /^(movie|tv)-(\d{1,10})$/;

export const LocalNameSchema = z.object({
  title: z.string().max(300).optional(),
  description: z.string().max(400).optional(),
});
export type LocalName = z.infer<typeof LocalNameSchema>;

export const NamesAnswerSchema = z.object({ names: z.record(z.string(), LocalNameSchema) });
export type NamesAnswer = z.infer<typeof NamesAnswerSchema>;

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
