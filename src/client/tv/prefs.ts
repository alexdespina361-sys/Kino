import { z } from "zod";
import { CaptionStyleSchema, defaultTrack, normalizeLang, SubtitleSyncModeSchema, type PlayerTrack } from "../../shared";

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
    /** Whether the subtitles are timed to the sound by themselves while a video plays (on unless the viewer turned it off). */
    subtitleSync: z.boolean().optional(),
    /** The way it times them, when the viewer chose the light one (see `SubtitleSyncModeSchema`). */
    subtitleSyncMode: SubtitleSyncModeSchema.optional(),
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

/** At or below these, a screen counts as a weaker one (see `defaultSyncMode`). */
export const WEAK_DEVICE = { cores: 4, memoryGb: 4 } as const;

/**
 * How a screen times subtitles until its viewer picks a way: Light on a weaker device, Thorough on the others (the owner's yes, 16 Nov evening).
 * Weaker means it says it has 4 processor threads or fewer, or 4 GB of memory or less. Chrome rounds its memory figure down, and other
 * browsers don't give one at all; then the threads decide. The whole-sound way costs about 0.75 of a core while a film plays, and Light about 0.65,
 * with the recogniser busy about 20 s instead of about 50 s per 4 minutes. On 4 threads that difference is felt; on 16 it is not.
 */
export function defaultSyncMode(device: { cores?: number | undefined; memoryGb?: number | undefined }): "full" | "light" {
  const weak = (device.cores !== undefined && device.cores > 0 && device.cores <= WEAK_DEVICE.cores) || (device.memoryGb !== undefined && device.memoryGb <= WEAK_DEVICE.memoryGb);
  return weak ? "light" : "full";
}

/** This screen's own figures, for `defaultSyncMode`. */
export function thisDevice(): { cores?: number; memoryGb?: number } {
  if (typeof navigator === "undefined") return {};
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return { ...(navigator.hardwareConcurrency ? { cores: navigator.hardwareConcurrency } : {}), ...(typeof memoryGb === "number" ? { memoryGb } : {}) };
}

/** Remember a track the viewer picked. Language is stored normalised so "eng" and "en" are the same wish. */
export function describeTrack(track: PlayerTrack): ChosenTrack {
  const lang = normalizeLang(track.lang);
  return { ...(lang ? { lang } : {}), label: track.label };
}

/** The track that best matches what the viewer chose before: the same one by name, else the best-fitting release of the same language. */
export function pickTrack(tracks: readonly PlayerTrack[], wanted: ChosenTrack): number | undefined {
  const byLabel = tracks.find((track) => track.label.toLowerCase() === wanted.label.toLowerCase());
  if (byLabel || !wanted.lang) return byLabel?.id;
  return defaultTrack(tracks.filter((track) => normalizeLang(track.lang) === wanted.lang))?.id;
}

/** The languages a profile chose for subtitles, in its order, and whether it wants no others offered (settings: "Subtitle languages", "Only these"). */
export interface SubtitleLanguages {
  chosen?: readonly string[] | undefined;
  only?: boolean | undefined;
}

/**
 * The subtitles a film starts with. What the viewer did last time comes first: off stays off (-1), and the track they picked is picked again when the
 * film has it. Then the languages the profile chose, in its order. Then English, unless the profile said "only these". And when none of that is there,
 * nothing is turned on (undefined): a film whose only subtitles are in a language nobody asked for starts without them, and they are one press away.
 */
export function pickBaseSubtitleTrack(tracks: readonly PlayerTrack[], wanted?: ChosenTrack | "off", languages: SubtitleLanguages = {}): number | undefined {
  if (wanted === "off") return -1;
  if (wanted) {
    const chosen = pickTrack(tracks, wanted);
    if (chosen !== undefined) return chosen;
  }
  // (The best-fitting release of a language, and never one of only songs or forced lines: see `defaultTrack`.)
  const bestOf = (lang: string) => defaultTrack(tracks.filter((track) => normalizeLang(track.lang) === lang));
  for (const lang of [...(languages.chosen ?? []), ...(languages.only ? [] : ["en"])]) {
    const found = bestOf(normalizeLang(lang) ?? lang);
    if (found !== undefined) return found.id;
  }
  return undefined;
}
