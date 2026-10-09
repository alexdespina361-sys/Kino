import { z } from "zod";
import { normalizeLang, type PlayerTrack } from "../../shared";

/**
 * What the TV remembers about how you like to watch, so the second episode starts the way the first one ended:
 * subtitles on or off and in which language, the audio language, and how big the subtitles are.
 * Stored on the TV itself (localStorage); everything here is pure so it can be tested without a browser.
 */
const ChosenTrackSchema = z.object({ lang: z.string().max(20).optional(), label: z.string().max(100) });
export type ChosenTrack = z.infer<typeof ChosenTrackSchema>;

export const SUBTITLE_SIZES = ["small", "medium", "large"] as const;
export type SubtitleSize = (typeof SUBTITLE_SIZES)[number];

const PrefsSchema = z.object({
  /** "off" is a choice too: someone who turned subtitles off doesn't want them back next episode. */
  subtitles: z.union([z.literal("off"), ChosenTrackSchema]).optional(),
  audio: ChosenTrackSchema.optional(),
  subtitleSize: z.enum(SUBTITLE_SIZES).optional(),
});
export type Prefs = z.infer<typeof PrefsSchema>;

export const PREFS_KEY = "tv.prefs";

export function parsePrefs(raw: string | undefined): Prefs {
  if (!raw) return {};
  try {
    const result = PrefsSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

export const serializePrefs = (prefs: Prefs) => JSON.stringify(prefs);

/** Remember a track the viewer picked. Language is stored normalised so "eng" and "en" are the same wish. */
export function describeTrack(track: PlayerTrack): ChosenTrack {
  const lang = normalizeLang(track.lang);
  return { ...(lang ? { lang } : {}), label: track.label };
}

/** The track that best matches what the viewer chose before: same language, else same name. */
export function pickTrack(tracks: readonly PlayerTrack[], wanted: ChosenTrack): number | undefined {
  if (wanted.lang) {
    const byLang = tracks.find((track) => normalizeLang(track.lang) === wanted.lang);
    if (byLang) return byLang.id;
  }
  return tracks.find((track) => track.label.toLowerCase() === wanted.label.toLowerCase())?.id;
}

/**
 * Subtitle text size as a share of the screen height, so it is the same on every TV. (`em` is no use here: inside ::cue
 * it is relative to the browser's own cue size, which is already 5% of the video's height.)
 */
export const SUBTITLE_FONT_SIZE: Record<SubtitleSize, string> = { small: "3.6vh", medium: "4.6vh", large: "6vh" };
