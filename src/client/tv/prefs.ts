import { z } from "zod";
import { CaptionStyleSchema, defaultTrack, languageName, normalizeLang, SubtitleSyncModeSchema, versionLabel, type PlayerTrack } from "../../shared";

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

export function isPlainTrack(track: PlayerTrack): boolean {
  const code = normalizeLang(track.lang);
  if (!code) return false;
  const names = [languageName(code, "en"), languageName(code, code), code].filter((name): name is string => Boolean(name)).sort((a, b) => b.length - a.length);
  return versionLabel(track, names, 0, "") === "";
}

const bestOf = (tracks: readonly PlayerTrack[], plainFirst: boolean): PlayerTrack | undefined => (plainFirst ? tracks.find(isPlainTrack) : undefined) ?? defaultTrack(tracks);

export function pickTrack(tracks: readonly PlayerTrack[], wanted: ChosenTrack, plainFirst = false): number | undefined {
  const byLabel = tracks.find((track) => track.label.toLowerCase() === wanted.label.toLowerCase());
  if (byLabel || !wanted.lang) return byLabel?.id;
  return bestOf(tracks.filter((track) => normalizeLang(track.lang) === wanted.lang), plainFirst)?.id;
}

export interface SubtitlePick {
  chosen?: readonly string[] | undefined;
  only?: boolean | undefined;
  plainFirst?: boolean | undefined;
}

export function pickBaseSubtitleTrack(tracks: readonly PlayerTrack[], wanted?: ChosenTrack | "off", pick: SubtitlePick = {}): number | undefined {
  if (wanted === "off") return -1;
  const plainFirst = pick.plainFirst === true;
  if (wanted) {
    const chosen = pickTrack(tracks, wanted, plainFirst);
    if (chosen !== undefined) return chosen;
  }
  for (const lang of [...(pick.chosen ?? []), ...(pick.only ? [] : ["en"])]) {
    const code = normalizeLang(lang) ?? lang;
    const found = bestOf(tracks.filter((track) => normalizeLang(track.lang) === code), plainFirst);
    if (found !== undefined) return found.id;
  }
  return undefined;
}
