import { z } from "zod";
import { SUBSYNC_MAX_LINES } from "./subsync";

export const OFFICIAL_LANGS = ["en", "ro"] as const;
export type OfficialLang = (typeof OFFICIAL_LANGS)[number];
export const isOfficialLang = (lang: string | undefined): lang is OfficialLang => lang === "en" || lang === "ro";

export const OFFICIAL_NAME = "Kino Official";
export const OFFICIAL_PATH = "/api/subtitles/official/";

export const OFFICIAL_MIN_PLACED = 0.9;
export const OFFICIAL_MIN_WORDS = 0.6;
export const OFFICIAL_MIN_LINES = 40;

const Cs = z.number().int().min(0).max(24 * 3600 * 100);

export const OfficialOfferLineSchema = z.union([z.tuple([Cs, Cs, Cs, z.union([z.literal(0), z.literal(1)])]), z.null()]);
export type OfficialOfferLine = z.infer<typeof OfficialOfferLineSchema>;

export const OfficialOfferSchema = z.object({
  v: z.literal(1),
  track: z.string().min(1).max(2048),
  duration: z.number().min(60).max(6 * 3600),
  lines: z.array(OfficialOfferLineSchema).min(OFFICIAL_MIN_LINES).max(SUBSYNC_MAX_LINES),
});
export type OfficialOffer = z.infer<typeof OfficialOfferSchema>;

export function offerShares(lines: readonly OfficialOfferLine[]): { placed: number; words: number } {
  if (lines.length === 0) return { placed: 0, words: 0 };
  let placed = 0;
  let words = 0;
  for (const line of lines) {
    if (!line) continue;
    placed++;
    if (line[3] === 1) words++;
  }
  return { placed: placed / lines.length, words: words / lines.length };
}

export const goodEnoughToOffer = (lines: readonly OfficialOfferLine[]): boolean => {
  if (lines.length < OFFICIAL_MIN_LINES) return false;
  const { placed, words } = offerShares(lines);
  return placed >= OFFICIAL_MIN_PLACED && words >= OFFICIAL_MIN_WORDS;
};
