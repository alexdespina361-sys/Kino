import { z } from "zod";
import { CaptionStyleSchema, normalizeLang, type PlayerTrack } from "../../shared";

/**
 * What the TV remembers about how you like to watch, so the second episode starts the way the first one ended:
 * subtitles on or off and in which language, the audio language, and how the subtitles look.
 * Stored on the TV itself (localStorage); everything here is pure so it can be tested without a browser.
 */
const ChosenTrackSchema = z.object({ lang: z.string().max(20).optional(), label: z.string().max(100) });
export type ChosenTrack = z.infer<typeof ChosenTrackSchema>;

const PrefsSchema = z
  .object({
    /** "off" is a choice too: someone who turned subtitles off doesn't want them back next episode. */
    subtitles: z.union([z.literal("off"), ChosenTrackSchema]).optional(),
    audio: ChosenTrackSchema.optional(),
    /** Only what the viewer changed; the rest is the default look. */
    captionStyle: CaptionStyleSchema.partial().optional(),
    subtitleDelay: z.number().optional(),
    /** Older versions stored just a size. */
    subtitleSize: z.enum(["small", "medium", "large"]).optional(),
  })
  .transform(({ subtitleSize, ...prefs }) =>
    subtitleSize && !prefs.captionStyle?.size ? { ...prefs, captionStyle: { ...prefs.captionStyle, size: subtitleSize } } : prefs,
  );
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
