import { z } from "zod";
import { SUBSYNC_MAX_LINES } from "./subsync";

/**
 * Kino Official subtitles (see docs/official-subtitles.md): for a film or an episode of the library, one file for each language, kept by the
 * server, with the text of a subtitle site's file cleaned up and the times that a screen's aligner found for it on the film's sound. A screen
 * that has timed a file well sends what it found (an offer, below); the server takes the text from the file itself, never from the screen.
 */

/** The languages a Kino Official subtitle is made in. */
export const OFFICIAL_LANGS = ["en", "ro"] as const;
export type OfficialLang = (typeof OFFICIAL_LANGS)[number];
export const isOfficialLang = (lang: string | undefined): lang is OfficialLang => lang === "en" || lang === "ro";

/** What a Kino Official track's name ends with ("English · Kino Official"). The menus put it first of its language by this (`releaseRank`). */
export const OFFICIAL_NAME = "Kino Official";
/** Where a Kino Official file is served from: a screen never offers one of these (it is already one). */
export const OFFICIAL_PATH = "/api/subtitles/official/";

/**
 * A screen offers its timing of a file once this share of the file's lines was placed by a solve (or by a timing another screen left that it
 * came to believe), and this share by the recogniser's words: the voice detector alone can be seconds off on music and effects.
 */
export const OFFICIAL_MIN_PLACED = 0.9;
export const OFFICIAL_MIN_WORDS = 0.6;
/** Fewest lines a file must have to be offered: a handful of lines is a song or the forced lines of one scene, not a film's subtitles. */
export const OFFICIAL_MIN_LINES = 40;

/** A time in centiseconds (a film of up to a day). */
const Cs = z.number().int().min(0).max(24 * 3600 * 100);

/**
 * One line of the file, in the file's order: `[where the file starts it, where it starts and ends on the film (all in centiseconds), 1 when the
 * recogniser's words placed it, else 0]`, or null for a line that was not placed. The file's own start is how the server knows the screen read
 * the same file it has (each line where the file has it).
 */
export const OfficialOfferLineSchema = z.union([z.tuple([Cs, Cs, Cs, z.union([z.literal(0), z.literal(1)])]), z.null()]);
export type OfficialOfferLine = z.infer<typeof OfficialOfferLineSchema>;

export const OfficialOfferSchema = z.object({
  v: z.literal(1),
  /** The track's link, as the server listed it for the film (`/api/subtitles/ro/...` or `/api/proxy?url=...`). */
  track: z.string().min(1).max(2048),
  /** The length of the film the screen played (seconds): the cut the times are for. */
  duration: z.number().min(60).max(6 * 3600),
  lines: z.array(OfficialOfferLineSchema).min(OFFICIAL_MIN_LINES).max(SUBSYNC_MAX_LINES),
});
export type OfficialOffer = z.infer<typeof OfficialOfferSchema>;

/** The share of the lines that were placed, and of those placed by words. */
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

/** Whether a timing is good enough to make a Kino Official subtitle of. */
export const goodEnoughToOffer = (lines: readonly OfficialOfferLine[]): boolean => {
  if (lines.length < OFFICIAL_MIN_LINES) return false;
  const { placed, words } = offerShares(lines);
  return placed >= OFFICIAL_MIN_PLACED && words >= OFFICIAL_MIN_WORDS;
};
