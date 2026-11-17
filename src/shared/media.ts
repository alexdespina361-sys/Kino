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
  directUrl: z.string().max(2048).optional(),
});

/** Another way to get the same video (a mirror, another server). The TV falls back to these when the main stream fails. */
export const AlternateSourceSchema = z.object({
  /** What the picker calls it. Without one it is "Source 2", "Source 3"... */
  label: z.string().max(60).optional(),
  stream: StreamSchema,
  /** Subtitles that belong to this stream; without them the main ones are used. */
  subtitles: z.array(SubtitleTrackSchema).optional(),
  /** Set when this is the main stream again in another quality ("720p"), not another place to get the film from: it is listed under Quality, not under Source. */
  quality: z.string().max(20).optional(),
});
export type AlternateSource = z.infer<typeof AlternateSourceSchema>;
export const MAX_ALTERNATES = 8;

/** A stretch of an episode the player offers to skip, in seconds from its start (see shared/skip.ts). */
export const SkipIntervalSchema = z
  .object({ start: z.number().finite().min(0).max(86_400), end: z.number().finite().min(0).max(86_400) })
  .refine((interval) => interval.end > interval.start, "Must end after it starts");
export type SkipInterval = z.infer<typeof SkipIntervalSchema>;

/** Where an episode's opening (`intro`), "previously on" (`recap`) and closing credits (`outro`) are, those that are known. */
export const SkipTimesSchema = z.object({ intro: SkipIntervalSchema.optional(), recap: SkipIntervalSchema.optional(), outro: SkipIntervalSchema.optional() });
export type SkipTimes = z.infer<typeof SkipTimesSchema>;

/**
 * What a look-up knew of an anime without asking anyone (TMDB had already said it is a Japanese, Chinese or Korean animation, and under which name): the
 * title, season and episode it was asked for. The player asks `/api/anime/skip` with it once it knows how long the episode is (AniSkip's times are kept for
 * each cut of an episode by its length), so that nothing is asked while the film is being found.
 */
export const AnimeHintSchema = z.object({ title: z.string().min(1).max(200), season: z.number().int().min(1).max(100), episode: z.number().int().min(1).max(5000) });
export type AnimeHint = z.infer<typeof AnimeHintSchema>;

/** The only thing the TV player ever consumes. Resolvers all produce this. */
export const NormalizedMediaSchema = z.object({
  title: z.string().max(300).optional(),
  /** What the main stream is called in the Source picker ("Japanese (Sub)", "English Dub"): empty for "Source 1". */
  sourceLabel: z.string().max(60).optional(),
  stream: StreamSchema,
  /** The quality the main stream is in, when the alternates hold the same stream in others (see `AlternateSourceSchema.quality`). */
  quality: z.string().max(20).optional(),
  subtitles: z.array(SubtitleTrackSchema).optional(),
  series: SeriesInfoSchema.optional(),
  /** Other sources for the same video, in the order to try them. The main `stream` is always tried first. */
  alternates: z.array(AlternateSourceSchema).max(MAX_ALTERNATES).optional(),
  /** The link that plays this again, which is what "continue watching" and the history are saved against (the stream's own link may stop working). Filled in by the server from what was asked for. */
  page: z.string().max(2048).optional(),
  /** A picture (upright and wide) and a year for cards, when whoever asked for it knew them (a library tile did). */
  poster: z.string().max(2048).refine(isMediaUrl, "Must be an http(s) URL or a root-relative path").optional(),
  backdrop: z.string().max(2048).refine(isMediaUrl, "Must be an http(s) URL or a root-relative path").optional(),
  year: z.number().int().min(1800).max(2200).optional(),
  /** Where the source itself says this video's opening and credits are (HiAnime does): exact for this stream, and taken over AniSkip's. */
  skip: SkipTimesSchema.optional(),
  /** An anime the player may ask AniSkip's times for (see `AnimeHintSchema`). */
  anime: AnimeHintSchema.optional(),
});
export type NormalizedMedia = z.infer<typeof NormalizedMediaSchema>;

/**
 * What a screen knows about a title it asks to play: sent along so the card for it has a picture, and so the screen that plays it can show the
 * title and its picture while the video is still being found (the title is only shown: what the source calls the film is what is kept).
 */
export const PlayHintSchema = z.object({
  poster: NormalizedMediaSchema.shape.poster,
  backdrop: NormalizedMediaSchema.shape.backdrop,
  year: NormalizedMediaSchema.shape.year,
  title: NormalizedMediaSchema.shape.title,
});
export type PlayHint = z.infer<typeof PlayHintSchema>;

/** The media with what the one who asked for it knew about it, without overriding what the source said. */
export function withHint(media: NormalizedMedia, hint: PlayHint | undefined): NormalizedMedia {
  if (!hint) return media;
  const poster = media.poster ?? hint.poster;
  const backdrop = media.backdrop ?? hint.backdrop;
  const year = media.year ?? hint.year;
  if (poster === media.poster && backdrop === media.backdrop && year === media.year) return media;
  return { ...media, ...(poster ? { poster } : {}), ...(backdrop ? { backdrop } : {}), ...(year ? { year } : {}) };
}

/* ------------------------------ fitting ------------------------------ */

/**
 * `media` made to fit what a screen takes (`NormalizedMediaSchema`), and which of its fields did not (their places, never what was in them).
 *
 * A screen checks every message it is sent and lets go of one that does not fit without a word: a look-up that found a video with a ninth alternate, a
 * label a few letters too long or a subtitle whose link is past the limit was a film that would not start, with nothing anywhere to say why. What is
 * too long is cut, what is too many is cut off at the limit, and what cannot be made to fit (a subtitle, an alternate, a picture) is left out: the film
 * plays without it. `media` is null only when the video's own address does not fit, which leaves nothing to play.
 */
export function fitMedia(media: NormalizedMedia): { media: NormalizedMedia | null; unfit: string[] } {
  const asIs = NormalizedMediaSchema.safeParse(media);
  if (asIs.success) return { media, unfit: [] };
  const unfit = [...new Set(asIs.error.issues.map((issue) => issue.path.join(".").slice(0, 60)))].slice(0, 12);

  const text = (value: unknown, max: number): string | undefined => (typeof value === "string" ? value.slice(0, max) : undefined);
  const stream = (found: NormalizedMedia["stream"] | undefined): NormalizedMedia["stream"] | undefined => {
    if (!found) return undefined;
    const whole = StreamSchema.safeParse(found);
    if (whole.success) return whole.data;
    // (The address a screen may ask the other end at directly is an extra: without it the screen asks through the relay.)
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
  // (Where to skip is an extra like a picture: what of it does not fit is left out, and the film plays without a Skip button.)
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

/* ------------------------------ sources ------------------------------ */

export interface PlayableSource {
  /** What the source called it, if it did: the screen names the others ("Source 2"...) in its own language. */
  label: string | undefined;
  stream: NormalizedMedia["stream"];
  subtitles: SubtitleTrack[] | undefined;
  /** The quality this one is in, when it is one of several of the same stream. */
  quality?: string | undefined;
}

/** The main stream and then the alternates, in the order to try them. */
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

/** The labels an anime's two audios have among its sources ("Japanese (Sub)", "English Dub", "Server 2 (English Dub)"): the only ones the setting picks between. */
const JAPANESE_AUDIO = /\bjapanese\b/i;
const ENGLISH_DUB = /\benglish\s+dub\b/i;

/**
 * Where the user's preferred anime audio ("jp", the default, or "eng") is among a title's sources: `undefined` when the title has no such source - any film or
 * show that is not an anime offered in that audio. (Only these exact labels: a Romanian dub, "Română (Dublat)", or a source whose name says "sub" is not an anime's
 * audio, and a title that has none is started from its first source, or left on the one it plays, as before.)
 */
export function preferredSourceIndex(media: NormalizedMedia, animeAudio: "jp" | "eng" | undefined): number | undefined {
  const sources = sourcesOf(media);
  const wanted = animeAudio === "eng" ? ENGLISH_DUB : JAPANESE_AUDIO;
  const at = sources.findIndex((source) => wanted.test(source.label ?? ""));
  return at >= 0 ? at : undefined;
}

/** What the pickers list, as places in `sourcesOf`. */
export interface SourceMenus {
  /** The places to get the film from. The main stream stands for all of its qualities. */
  sources: number[];
  /** The main stream and the alternates that are it again in another quality, in the order the source gave them. Empty when there is nothing to choose. */
  qualities: number[];
}

/**
 * A film's sources and its qualities are two questions. Alternates that are the main stream in another quality (`quality`) are not other sources: they
 * are listed under Quality, and the main stream stands for them all under Source.
 */
export function sourceMenus(all: readonly PlayableSource[]): SourceMenus {
  const everything = all.map((_, index) => index);
  const qualities = everything.filter((index) => all[index]!.quality);
  if (qualities.length < 2 || qualities[0] !== 0) return { sources: everything, qualities: [] };
  return { sources: everything.filter((index) => index === 0 || !all[index]!.quality), qualities };
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

/** "S1:E3": what a source calls an episode it has no name for. */
const PLACEHOLDER_TITLE = /^S\d+\s*:?\s*E\d+$/i;

/** "S1:E3" titles are placeholders from the source; anything else is a real episode name. `unnamed` (in the screen's language) is what the rest are called. */
export function episodeName(episode: EpisodeRef, unnamed: string): string {
  const title = episode.title?.trim();
  return title && !PLACEHOLDER_TITLE.test(title) ? title : unnamed;
}

/**
 * What the episode that is playing is called, when it has a name besides its number: the one the library knows it by (`known`), or else
 * the one the source listed it with; a name that is only the number ("S1:E3", "Episode 3") is not one, in either, and the other is tried.
 * `undefined` for a film, and for an episode of which only the number is known.
 */
export function playingEpisodeName(series: SeriesInfo | undefined, known?: string): string | undefined {
  if (!series) return undefined;
  const listed = series.episodes?.find((episode) => isCurrentEpisode(series, episode))?.title;
  for (const title of [known, listed]) {
    const name = title?.trim();
    if (name && !PLACEHOLDER_TITLE.test(name) && !/^(?:episode|episodio|episodul|ep\.?)\s*\d+$/i.test(name)) return name;
  }
  return undefined;
}

/** Same show, whatever the episode: "Show · S1 E3" -> "Show". Lets lists keep one entry per show. */
export function seriesKeyOf(media: NormalizedMedia): string | undefined {
  return media.series ? media.title?.split("·")[0]?.trim() || undefined : undefined;
}

/**
 * Whether `next` is the very episode of the very show that `current` already is, so that a new copy of it brings news (a picture, the
 * list of episodes) and no new video. (Two shows both have an S1 E1: the numbers alone say nothing.)
 */
export const isSameEpisode = (current: NormalizedMedia | null | undefined, next: NormalizedMedia): boolean =>
  Boolean(
    current?.series &&
      next.series &&
      seriesKeyOf(current) === seriesKeyOf(next) &&
      current.series.season === next.series.season &&
      current.series.episode === next.series.episode,
  );

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
