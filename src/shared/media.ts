import { z } from "zod";

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

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

export const EpisodeRefSchema = NextEpisodeSchema;
export type EpisodeRef = NextEpisode;

export const SeriesInfoSchema = z.object({
  season: z.number().int(),
  episode: z.number().int(),
  next: NextEpisodeSchema.optional(),
  episodes: z.array(EpisodeRefSchema).max(400).optional(),
});
export type SeriesInfo = z.infer<typeof SeriesInfoSchema>;

const StreamSchema = z.object({
  url: z.string().max(2048).refine(isMediaUrl, "Must be an http(s) URL or a root-relative path"),
  type: StreamTypeSchema,
  directUrl: z.string().max(2048).optional(),
});

export const AlternateSourceSchema = z.object({
  label: z.string().max(60).optional(),
  stream: StreamSchema,
  subtitles: z.array(SubtitleTrackSchema).optional(),
  quality: z.string().max(20).optional(),
});
export type AlternateSource = z.infer<typeof AlternateSourceSchema>;
export const MAX_ALTERNATES = 8;

export const SkipIntervalSchema = z
  .object({ start: z.number().finite().min(0).max(86_400), end: z.number().finite().min(0).max(86_400) })
  .refine((interval) => interval.end > interval.start, "Must end after it starts");
export type SkipInterval = z.infer<typeof SkipIntervalSchema>;

export const SkipTimesSchema = z.object({ intro: SkipIntervalSchema.optional(), recap: SkipIntervalSchema.optional(), outro: SkipIntervalSchema.optional() });
export type SkipTimes = z.infer<typeof SkipTimesSchema>;

export const AnimeHintSchema = z.object({ title: z.string().min(1).max(200), season: z.number().int().min(1).max(100), episode: z.number().int().min(1).max(5000) });
export type AnimeHint = z.infer<typeof AnimeHintSchema>;

export const NormalizedMediaSchema = z.object({
  title: z.string().max(300).optional(),
  sourceLabel: z.string().max(60).optional(),
  stream: StreamSchema,
  quality: z.string().max(20).optional(),
  subtitles: z.array(SubtitleTrackSchema).optional(),
  series: SeriesInfoSchema.optional(),
  alternates: z.array(AlternateSourceSchema).max(MAX_ALTERNATES).optional(),
  page: z.string().max(2048).optional(),
  poster: z.string().max(2048).refine(isMediaUrl, "Must be an http(s) URL or a root-relative path").optional(),
  backdrop: z.string().max(2048).refine(isMediaUrl, "Must be an http(s) URL or a root-relative path").optional(),
  year: z.number().int().min(1800).max(2200).optional(),
  skip: SkipTimesSchema.optional(),
  anime: AnimeHintSchema.optional(),
});
export type NormalizedMedia = z.infer<typeof NormalizedMediaSchema>;

export const PlayHintSchema = z.object({
  poster: NormalizedMediaSchema.shape.poster,
  backdrop: NormalizedMediaSchema.shape.backdrop,
  year: NormalizedMediaSchema.shape.year,
  title: NormalizedMediaSchema.shape.title,
});
export type PlayHint = z.infer<typeof PlayHintSchema>;

export function withHint(media: NormalizedMedia, hint: PlayHint | undefined): NormalizedMedia {
  if (!hint) return media;
  const poster = media.poster ?? hint.poster;
  const backdrop = media.backdrop ?? hint.backdrop;
  const year = media.year ?? hint.year;
  if (poster === media.poster && backdrop === media.backdrop && year === media.year) return media;
  return { ...media, ...(poster ? { poster } : {}), ...(backdrop ? { backdrop } : {}), ...(year ? { year } : {}) };
}

export function fitMedia(media: NormalizedMedia): { media: NormalizedMedia | null; unfit: string[] } {
  const asIs = NormalizedMediaSchema.safeParse(media);
  if (asIs.success) return { media, unfit: [] };
  const unfit = [...new Set(asIs.error.issues.map((issue) => issue.path.join(".").slice(0, 60)))].slice(0, 12);

  const text = (value: unknown, max: number): string | undefined => (typeof value === "string" ? value.slice(0, max) : undefined);
  const stream = (found: NormalizedMedia["stream"] | undefined): NormalizedMedia["stream"] | undefined => {
    if (!found) return undefined;
    const whole = StreamSchema.safeParse(found);
    if (whole.success) return whole.data;
    const plain = StreamSchema.safeParse({ url: found.url, type: found.type });
    return plain.success ? plain.data : undefined;
  };
  const subtitles = (tracks: SubtitleTrack[] | undefined): SubtitleTrack[] | undefined => {
    if (!Array.isArray(tracks)) return undefined;
    const kept: SubtitleTrack[] = [];
    for (const track of tracks) {
      const lang = typeof track?.lang === "string" && track.lang.length <= 20 ? track.lang : undefined;
      const fitted = SubtitleTrackSchema.safeParse({ id: track?.id, label: text(track?.label, 100) ?? "", url: track?.url, ...(lang ? { lang } : {}) });
      if (fitted.success) kept.push(fitted.data);
    }
    return kept;
  };
  const episode = (ref: EpisodeRef | undefined): EpisodeRef | undefined => {
    const title = text(ref?.title, 300);
    const fitted = EpisodeRefSchema.safeParse({ season: ref?.season, episode: ref?.episode, url: ref?.url, ...(title ? { title } : {}) });
    return fitted.success ? fitted.data : undefined;
  };

  const main = stream(media.stream);
  if (!main) return { media: null, unfit };
  const title = text(media.title, 300);
  const sourceLabel = text(media.sourceLabel, 60);
  const subs = subtitles(media.subtitles);
  const alternates: AlternateSource[] = [];
  for (const alternate of Array.isArray(media.alternates) ? media.alternates : []) {
    if (alternates.length >= MAX_ALTERNATES) break;
    const its = stream(alternate?.stream);
    if (!its) continue;
    const label = text(alternate.label, 60);
    const own = subtitles(alternate.subtitles);
    const quality = text(alternate.quality, 20);
    alternates.push({ stream: its, ...(label ? { label } : {}), ...(own ? { subtitles: own } : {}), ...(quality ? { quality } : {}) });
  }
  let series: SeriesInfo | undefined;
  if (media.series && Number.isInteger(media.series.season) && Number.isInteger(media.series.episode)) {
    const next = episode(media.series.next);
    const episodes = Array.isArray(media.series.episodes) ? media.series.episodes.map(episode).filter((ref): ref is EpisodeRef => ref !== undefined).slice(0, 400) : undefined;
    series = { season: media.series.season, episode: media.series.episode, ...(next ? { next } : {}), ...(episodes ? { episodes } : {}) };
  }
  const picture = (value: unknown): string | undefined => (typeof value === "string" && value.length <= 2048 && isMediaUrl(value) ? value : undefined);
  const page = typeof media.page === "string" && media.page.length <= 2048 ? media.page : undefined;
  const poster = picture(media.poster);
  const backdrop = picture(media.backdrop);
  const year = typeof media.year === "number" && Number.isInteger(media.year) && media.year >= 1800 && media.year <= 2200 ? media.year : undefined;
  const skips: SkipTimes = {};
  for (const part of ["intro", "recap", "outro"] as const) {
    const fitted = SkipIntervalSchema.safeParse(media.skip?.[part]);
    if (fitted.success) skips[part] = fitted.data;
  }
  const skip = skips.intro || skips.recap || skips.outro ? skips : undefined;
  const anime = AnimeHintSchema.safeParse(media.anime);

  const fitted = NormalizedMediaSchema.safeParse({
    stream: main,
    ...(title ? { title } : {}),
    ...(sourceLabel ? { sourceLabel } : {}),
    ...(text(media.quality, 20) ? { quality: text(media.quality, 20) } : {}),
    ...(subs ? { subtitles: subs } : {}),
    ...(series ? { series } : {}),
    ...(alternates.length > 0 ? { alternates } : {}),
    ...(page ? { page } : {}),
    ...(poster ? { poster } : {}),
    ...(backdrop ? { backdrop } : {}),
    ...(year ? { year } : {}),
    ...(skip ? { skip } : {}),
    ...(anime.success ? { anime: anime.data } : {}),
  });
  return { media: fitted.success ? fitted.data : null, unfit };
}

export interface PlayableSource {
  label: string | undefined;
  stream: NormalizedMedia["stream"];
  subtitles: SubtitleTrack[] | undefined;
  quality?: string | undefined;
}

export function sourcesOf(media: NormalizedMedia): PlayableSource[] {
  return [
    { label: media.sourceLabel?.trim() || undefined, stream: media.stream, subtitles: media.subtitles, quality: media.quality?.trim() || undefined },
    ...(media.alternates ?? []).map((alternate) => ({
      label: alternate.label?.trim() || undefined,
      stream: alternate.stream,
      subtitles: alternate.subtitles ?? media.subtitles,
      quality: alternate.quality?.trim() || undefined,
    })),
  ];
}

const JAPANESE_AUDIO = /\bjapanese\b/i;
const ENGLISH_DUB = /\benglish\s+dub\b/i;

export function preferredSourceIndex(media: NormalizedMedia, animeAudio: "jp" | "eng" | undefined): number | undefined {
  const sources = sourcesOf(media);
  const dubbed = (source: (typeof sources)[number]) => ENGLISH_DUB.test(source.label ?? "");
  if (animeAudio === "eng") {
    const at = sources.findIndex(dubbed);
    return at >= 0 ? at : undefined;
  }
  const at = sources.findIndex((source) => JAPANESE_AUDIO.test(source.label ?? ""));
  if (at >= 0) return at;
  if (!sources.some(dubbed)) return undefined;
  const original = sources.findIndex((source) => !dubbed(source));
  return original >= 0 ? original : undefined;
}

export interface SourceMenus {
  sources: number[];
  qualities: number[];
}

export function sourceMenus(all: readonly PlayableSource[]): SourceMenus {
  const everything = all.map((_, index) => index);
  const qualities = everything.filter((index) => all[index]!.quality);
  if (qualities.length < 2 || qualities[0] !== 0) return { sources: everything, qualities: [] };
  return { sources: everything.filter((index) => index === 0 || !all[index]!.quality), qualities };
}

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

const PLACEHOLDER_TITLE = /^S\d+\s*:?\s*E\d+$/i;

export function episodeName(episode: EpisodeRef, unnamed: string): string {
  const title = episode.title?.trim();
  return title && !PLACEHOLDER_TITLE.test(title) ? title : unnamed;
}

export function playingEpisodeName(series: SeriesInfo | undefined, known?: string): string | undefined {
  if (!series) return undefined;
  const listed = series.episodes?.find((episode) => isCurrentEpisode(series, episode))?.title;
  for (const title of [known, listed]) {
    const name = title?.trim();
    if (name && !PLACEHOLDER_TITLE.test(name) && !/^(?:episode|episodio|episodul|ep\.?)\s*\d+$/i.test(name)) return name;
  }
  return undefined;
}

export function seriesKeyOf(media: NormalizedMedia): string | undefined {
  return media.series ? media.title?.split("·")[0]?.trim() || undefined : undefined;
}

export const isSameEpisode = (current: NormalizedMedia | null | undefined, next: NormalizedMedia): boolean =>
  Boolean(
    current?.series &&
      next.series &&
      seriesKeyOf(current) === seriesKeyOf(next) &&
      current.series.season === next.series.season &&
      current.series.episode === next.series.episode,
  );

export const stateIsFor = (media: NormalizedMedia, state: { stream?: string | undefined }) =>
  state.stream === undefined || state.stream === media.stream.url;

export const episodeLabel = (episode: EpisodeRef) => episode.title || `S${episode.season}:E${episode.episode}`;

export function previousEpisode(series: SeriesInfo | undefined): EpisodeRef | undefined {
  if (!series?.episodes?.length) return undefined;
  const sorted = sortEpisodes(series.episodes);
  const index = sorted.findIndex((episode) => isCurrentEpisode(series, episode));
  return index > 0 ? sorted[index - 1] : undefined;
}

export function completeSeries(media: NormalizedMedia): NormalizedMedia {
  const series = media.series;
  if (!series?.episodes?.length || series.next) return media;
  const sorted = sortEpisodes(series.episodes);
  const index = sorted.findIndex((episode) => isCurrentEpisode(series, episode));
  const next = index >= 0 ? sorted[index + 1] : undefined;
  return next ? { ...media, series: { ...series, next } } : media;
}
