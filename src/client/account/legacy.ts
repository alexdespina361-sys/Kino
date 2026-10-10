import { z } from "zod";
import { emptyData, progressKey, watchedKey, type ProfileData } from "../../shared";

/**
 * Before accounts, each screen kept its own history in localStorage ("Recently played" on the phone, the watched marks on both).
 * The first time the new store opens it takes those in, so nobody loses where they were; the old keys are removed after.
 */
export const LEGACY_KEYS = ["controller.history", "controller.watched", "tv.watched"] as const;

const HistorySchema = z.array(
  z.object({
    url: z.string().max(2048),
    title: z.string().max(300),
    seriesKey: z.string().max(300).optional(),
    position: z.number().finite().min(0),
    duration: z.number().finite().min(0),
    at: z.number().finite(),
  }),
);
const WatchedSchema = z.array(
  z.object({
    show: z.string().max(300),
    season: z.number().int(),
    episode: z.number().int(),
    position: z.number().finite().min(0),
    duration: z.number().finite().min(0),
    done: z.boolean(),
    at: z.number().finite(),
  }),
);

function parse<T>(schema: z.ZodType<T>, raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** What the old keys held, as profile data; undefined when there was none. */
export function readLegacy(read: (key: string) => string | null): ProfileData | undefined {
  const data = emptyData();
  for (const entry of parse(HistorySchema, read("controller.history")) ?? []) {
    data.progress.push({
      key: progressKey({ ...(entry.seriesKey ? { show: entry.seriesKey } : {}), url: entry.url }),
      at: entry.at,
      title: entry.seriesKey ?? entry.title,
      url: entry.url,
      position: entry.position,
      duration: entry.duration,
    });
  }
  const seen = new Set<string>();
  for (const entry of [...(parse(WatchedSchema, read("controller.watched")) ?? []), ...(parse(WatchedSchema, read("tv.watched")) ?? [])]) {
    const key = watchedKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    data.watched.push({ key, at: entry.at, show: entry.show, season: entry.season, episode: entry.episode, position: entry.position, duration: entry.duration, done: entry.done });
  }
  return data.progress.length > 0 || data.watched.length > 0 ? data : undefined;
}
