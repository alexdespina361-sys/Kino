import { useEffect, useState } from "react";
import type { LiveProgress, LiveWatched } from "../../shared";
import { describeStatus, episodeName, episodeStatus } from "../../shared";
import { t } from "../i18n";
import { useEpisodeDetails, useSeasons } from "../shared/episodeDetails";
import { formatLeft } from "../shared/format";
import { statusWords } from "../shared/words";
import { EpisodeRow, type EpisodeCard } from "./EpisodeRow";
import { showKeyOf, startOf, type Entry, type Start } from "./pages";

/** One episode of the season that is shown, as the page lists it. */
export interface PageEpisode {
  season: number;
  episode: number;
  /** What plays it. */
  url: string;
  /** Where it was left, when it was left part way. */
  startAt?: number;
  /** What Play on the page leads to. */
  target: boolean;
  card: EpisodeCard;
}

/** What a show's page lists under its buttons. */
export interface SeriesPage {
  /** The seasons that can be watched; none for a film, and until they are known. */
  seasons: number[];
  /** Whether the title is a show (the library says so, or it has seasons): the page makes room for the episodes. */
  isShow: boolean;
  /** The seasons are being asked for. */
  loading: boolean;
  /** Where Play leads: the episode this profile is at, else the first. */
  start: Start | undefined;
  /** The season that is shown: the one chosen, else the one Play leads to. */
  season: number | undefined;
  pick: (season: number) => void;
  /** Its episodes, in order: none while they are being asked for, and `null` when the library has nothing to list. */
  episodes: PageEpisode[] | null | undefined;
}

/**
 * Everything a show's own page is made of besides what any title's is: the seasons, and the episodes of the one that is shown with
 * what this profile did with each. Nothing for a film (its link is not even asked about when the library says it is one).
 * `browsing` is the season a page that is opened again was showing, when it was left.
 */
export function useSeriesPage(entry: Entry | undefined, progress: readonly LiveProgress[], watched: readonly LiveWatched[], browsing?: number): SeriesPage {
  const asked = entry !== undefined && !entry.opens && entry.url !== "" && entry.kind !== "movie";
  const found = useSeasons(asked ? entry.url : undefined);
  const seasons = found ?? [];
  const isShow = entry?.kind === "series" || seasons.length > 0;
  const start = entry && isShow ? startOf(entry, true, progress) : undefined;

  const [picked, setPicked] = useState<{ id: string; season: number } | undefined>(() => (entry && browsing !== undefined ? { id: entry.id, season: browsing } : undefined));
  // A page that was closed forgets the season that was browsed on it: it opens next on the one this profile is at.
  const open = entry !== undefined;
  useEffect(() => {
    if (!open) setPicked(undefined);
  }, [open]);
  const chosen = picked?.id === entry?.id ? picked?.season : undefined;
  const season = [chosen, start?.season].find((n) => n !== undefined && seasons.includes(n)) ?? seasons[0];
  const details = useEpisodeDetails(season === undefined ? undefined : entry?.url, season);

  let episodes: PageEpisode[] | null | undefined;
  if (!entry || (asked && found === undefined) || details === undefined) episodes = undefined; // still being asked for
  else if (season === undefined || details === null) episodes = null;
  else {
    const show = showKeyOf(entry, progress);
    const listed = [...details.values()].filter((detail) => detail.url).sort((a, b) => a.episode - b.episode);
    episodes = listed.map((detail): PageEpisode => {
      const status = episodeStatus(watched, show, season, detail.episode);
      const name = episodeName({ season, episode: detail.episode, url: detail.url!, ...(detail.title ? { title: detail.title } : {}) }, t("player.episodeN", { n: detail.episode }));
      return {
        season,
        episode: detail.episode,
        url: detail.url!,
        ...(status.kind === "started" ? { startAt: Math.floor(status.position) } : {}),
        target: start?.season === season && start.episode === detail.episode,
        card: {
          number: detail.episode,
          name,
          still: detail.still || entry?.backdrop || entry?.image,
          overview: detail.overview || (entry?.description && entry.description.length <= 400 ? entry.description : undefined),
          meta: describeStatus(status, statusWords()) ?? (detail.runtime ? formatLeft(detail.runtime * 60) : undefined),
          state: status.kind,
          fraction: status.kind === "started" ? status.fraction : undefined,
        },
      };
    });
    if (episodes.length === 0) episodes = null;
  }

  return { seasons, isShow, loading: found === undefined && asked, start, season, pick: (next) => entry && setPicked({ id: entry.id, season: next }), episodes };
}

/** Under a show's buttons: its seasons (when there is a choice) and the episodes of the one that is shown. The remote walks them as zones `seasons` and `episodes`. */
export function SeriesSection({ page, onPlay, onSlide }: { page: SeriesPage; onPlay: (episode: PageEpisode) => void; onSlide: (button: HTMLElement) => void }) {
  const { seasons, season, episodes } = page;
  return (
    <section className="tv-detail-eps" aria-label={t("player.episodes")} data-testid="tv-episodes">
      <h2 className="tv-detail-eps-title">{t("player.episodes")}</h2>
      {seasons.length > 1 && (
        <div className="tv-filters" role="radiogroup" aria-label={t("player.seasons")} onFocus={(event) => onSlide(event.target as HTMLElement)}>
          {seasons.map((number, col) => (
            <button
              key={number}
              className="tv-choice"
              role="radio"
              aria-checked={number === season}
              data-testid={`tv-season-${number}`}
              data-zone="seasons"
              data-row={0}
              data-col={col}
              onClick={() => page.pick(number)}
            >
              {t("player.season", { n: number })}
            </button>
          ))}
        </div>
      )}
      {episodes ? (
        <div className="tv-detail-list">
          {episodes.map((episode, row) => (
            <button
              key={`${episode.season}-${episode.episode}`}
              className="tv-opt tv-ep"
              data-testid="tv-episode"
              data-episode={episode.episode}
              data-zone="episodes"
              data-row={row}
              data-col={0}
              data-target={episode.target}
              data-active={episode.target}
              onClick={() => onPlay(episode)}
            >
              <EpisodeRow {...episode.card} />
            </button>
          ))}
        </div>
      ) : (
        <p className="tv-detail-eps-note" data-testid="tv-episodes-note">
          {episodes === null ? t("series.failed") : t("series.loading")}
        </p>
      )}
    </section>
  );
}
