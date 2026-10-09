import { z } from "zod";

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Absolute http(s) URL, or a root-relative path ("/fixtures/sample.mp4") the TV resolves against its own origin. */
export function isMediaUrl(value: string): boolean {
  return isHttpUrl(value) || /^\/(?!\/)/.test(value);
}

export const StreamTypeSchema = z.enum(["mp4", "hls"]);
export type StreamType = z.infer<typeof StreamTypeSchema>;

export const SubtitleTrackSchema = z.object({
  id: z.string().or(z.number()),
  label: z.string().max(100),
  lang: z.string().max(20).optional(),
  url: z.string().max(2048),
});
export type SubtitleTrack = z.infer<typeof SubtitleTrackSchema>;

export const NextEpisodeSchema = z.object({
  season: z.number().int(),
  episode: z.number().int(),
  title: z.string().max(300).optional(),
  url: z.string().max(2048),
});
export type NextEpisode = z.infer<typeof NextEpisodeSchema>;

/** One entry of a series' episode list. Same shape as `next`: a resolver can hand over the whole list. */
export const EpisodeRefSchema = NextEpisodeSchema;
export type EpisodeRef = NextEpisode;

export const SeriesInfoSchema = z.object({
  season: z.number().int(),
  episode: z.number().int(),
  next: NextEpisodeSchema.optional(),
  /** Every episode the source knows about, past and future, for the episode list. Optional: movies and one-off links have none. */
  episodes: z.array(EpisodeRefSchema).max(400).optional(),
});
export type SeriesInfo = z.infer<typeof SeriesInfoSchema>;

/** The only thing the TV player ever consumes. Resolvers all produce this. */
export const NormalizedMediaSchema = z.object({
  title: z.string().max(300).optional(),
  stream: z.object({
    url: z.string().max(2048).refine(isMediaUrl, "Must be an http(s) URL or a root-relative path"),
    type: StreamTypeSchema,
  }),
  subtitles: z.array(SubtitleTrackSchema).optional(),
  series: SeriesInfoSchema.optional(),
});
export type NormalizedMedia = z.infer<typeof NormalizedMediaSchema>;

/* ------------------------------ series helpers ------------------------------ */

/** Season order, then episode order, whatever order the source listed them in. */
export function sortEpisodes(episodes: readonly EpisodeRef[]): EpisodeRef[] {
  return [...episodes].sort((a, b) => a.season - b.season || a.episode - b.episode);
}

export interface SeasonGroup {
  season: number;
  episodes: EpisodeRef[];
}

export function groupBySeason(episodes: readonly EpisodeRef[]): SeasonGroup[] {
  const groups: SeasonGroup[] = [];
  for (const episode of sortEpisodes(episodes)) {
    const last = groups[groups.length - 1];
    if (last?.season === episode.season) last.episodes.push(episode);
    else groups.push({ season: episode.season, episodes: [episode] });
  }
  return groups;
}

export const isCurrentEpisode = (series: SeriesInfo, episode: EpisodeRef) =>
  series.season === episode.season && series.episode === episode.episode;

/** "S1:E3" titles are placeholders from the source; anything else is a real episode name. */
export function episodeName(episode: EpisodeRef): string {
  const title = episode.title?.trim();
  return title && !/^S\d+\s*:?\s*E\d+$/i.test(title) ? title : `Episode ${episode.episode}`;
}

/**
 * A source that lists every episode shouldn't also have to work out which one is next.
 * Fills `next` from the list when the source left it out; never overrides one it did set.
 */
export function completeSeries(media: NormalizedMedia): NormalizedMedia {
  const series = media.series;
  if (!series?.episodes?.length || series.next) return media;
  const sorted = sortEpisodes(series.episodes);
  const index = sorted.findIndex((episode) => isCurrentEpisode(series, episode));
  const next = index >= 0 ? sorted[index + 1] : undefined;
  return next ? { ...media, series: { ...series, next } } : media;
}
