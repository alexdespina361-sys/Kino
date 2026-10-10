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

const StreamSchema = z.object({
  url: z.string().max(2048).refine(isMediaUrl, "Must be an http(s) URL or a root-relative path"),
  type: StreamTypeSchema,
});

/** Another way to get the same video (a mirror, another server). The TV falls back to these when the main stream fails. */
export const AlternateSourceSchema = z.object({
  /** What the picker calls it. Without one it is "Source 2", "Source 3"... */
  label: z.string().max(60).optional(),
  stream: StreamSchema,
  /** Subtitles that belong to this stream; without them the main ones are used. */
  subtitles: z.array(SubtitleTrackSchema).optional(),
});
export type AlternateSource = z.infer<typeof AlternateSourceSchema>;
export const MAX_ALTERNATES = 8;

/** The only thing the TV player ever consumes. Resolvers all produce this. */
export const NormalizedMediaSchema = z.object({
  title: z.string().max(300).optional(),
  stream: StreamSchema,
  subtitles: z.array(SubtitleTrackSchema).optional(),
  series: SeriesInfoSchema.optional(),
  /** Other sources for the same video, in the order to try them. The main `stream` is always tried first. */
  alternates: z.array(AlternateSourceSchema).max(MAX_ALTERNATES).optional(),
});
export type NormalizedMedia = z.infer<typeof NormalizedMediaSchema>;

/* ------------------------------ sources ------------------------------ */

export interface PlayableSource {
  label: string;
  stream: NormalizedMedia["stream"];
  subtitles: SubtitleTrack[] | undefined;
}

/** The main stream and then the alternates, each with a name for the picker. */
export function sourcesOf(media: NormalizedMedia): PlayableSource[] {
  return [
    { label: "Source 1", stream: media.stream, subtitles: media.subtitles },
    ...(media.alternates ?? []).map((alternate, index) => ({
      label: alternate.label?.trim() || `Source ${index + 2}`,
      stream: alternate.stream,
      subtitles: alternate.subtitles ?? media.subtitles,
    })),
  ];
}

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

/** Same show, whatever the episode: "Show · S1 E3" -> "Show". Lets lists keep one entry per show. */
export function seriesKeyOf(media: NormalizedMedia): string | undefined {
  return media.series ? media.title?.split("·")[0]?.trim() || undefined : undefined;
}

/** Whether a player state is about this media. (The phone holds the new media a moment before the TV reports on it.) */
export const stateIsFor = (media: NormalizedMedia, state: { stream?: string | undefined }) =>
  state.stream === undefined || state.stream === media.stream.url;

/** What an episode is called on a button: its title, or "S1:E3" when the source gave none. */
export const episodeLabel = (episode: EpisodeRef) => episode.title || `S${episode.season}:E${episode.episode}`;

/**
 * The episode before the current one, from the source's list. (The list is all a source has to give: unlike `next`,
 * which the server fills in so the TV can preload it, this is worked out where it is used.)
 */
export function previousEpisode(series: SeriesInfo | undefined): EpisodeRef | undefined {
  if (!series?.episodes?.length) return undefined;
  const sorted = sortEpisodes(series.episodes);
  const index = sorted.findIndex((episode) => isCurrentEpisode(series, episode));
  return index > 0 ? sorted[index - 1] : undefined;
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
