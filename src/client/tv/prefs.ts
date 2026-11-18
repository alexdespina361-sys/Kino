import { z } from "zod";
import { CaptionStyleSchema, defaultTrack, normalizeLang, SubtitleSyncModeSchema, type PlayerTrack } from "../../shared";

const ChosenTrackSchema = z.object({ lang: z.string().max(20).optional(), label: z.string().max(100) });
export type ChosenTrack = z.infer<typeof ChosenTrackSchema>;

const PrefsSchema = z
  .object({
    subtitles: z.union([z.literal("off"), ChosenTrackSchema]).optional(),
    audio: ChosenTrackSchema.optional(),
    captionStyle: CaptionStyleSchema.partial().optional(),
    subtitleDelay: z.number().optional(),
    subtitleSync: z.boolean().optional(),
    subtitleSyncMode: SubtitleSyncModeSchema.optional(),
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

export const WEAK_DEVICE = { cores: 4, memoryGb: 4 } as const;

export function defaultSyncMode(device: { cores?: number | undefined; memoryGb?: number | undefined }): "full" | "light" {
  const weak = (device.cores !== undefined && device.cores > 0 && device.cores <= WEAK_DEVICE.cores) || (device.memoryGb !== undefined && device.memoryGb <= WEAK_DEVICE.memoryGb);
  return weak ? "light" : "full";
}

export function thisDevice(): { cores?: number; memoryGb?: number } {
  if (typeof navigator === "undefined") return {};
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return { ...(navigator.hardwareConcurrency ? { cores: navigator.hardwareConcurrency } : {}), ...(typeof memoryGb === "number" ? { memoryGb } : {}) };
}

export function describeTrack(track: PlayerTrack): ChosenTrack {
  const lang = normalizeLang(track.lang);
  return { ...(lang ? { lang } : {}), label: track.label };
}

export function pickTrack(tracks: readonly PlayerTrack[], wanted: ChosenTrack): number | undefined {
  const byLabel = tracks.find((track) => track.label.toLowerCase() === wanted.label.toLowerCase());
  if (byLabel || !wanted.lang) return byLabel?.id;
  return defaultTrack(tracks.filter((track) => normalizeLang(track.lang) === wanted.lang))?.id;
}

export interface SubtitleLanguages {
  chosen?: readonly string[] | undefined;
  only?: boolean | undefined;
}

export function pickBaseSubtitleTrack(tracks: readonly PlayerTrack[], wanted?: ChosenTrack | "off", languages: SubtitleLanguages = {}): number | undefined {
  if (wanted === "off") return -1;
  if (wanted) {
    const chosen = pickTrack(tracks, wanted);
    if (chosen !== undefined) return chosen;
  }
  const bestOf = (lang: string) => defaultTrack(tracks.filter((track) => normalizeLang(track.lang) === lang));
  for (const lang of [...(languages.chosen ?? []), ...(languages.only ? [] : ["en"])]) {
    const found = bestOf(normalizeLang(lang) ?? lang);
    if (found !== undefined) return found.id;
  }
  return undefined;
}
