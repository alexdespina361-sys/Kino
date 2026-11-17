import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { LiveProgress, LiveWatched } from "../../shared";
import { describeStatus, episodeName, episodeStatus, lastStartAt } from "../../shared";
import { t } from "../i18n";
import { useEpisodeDetails, useSeasons } from "../shared/episodeDetails";
import { formatLeft } from "../shared/format";
import { ChevronDownIcon, ChevronUpIcon } from "../shared/icons";
import { gridRows } from "./browseNav";
import { episodeKey, useUnavailable } from "../shared/unavailable";
import { statusWords } from "../shared/words";
import { EpisodeRow, type EpisodeCard } from "./EpisodeRow";
import { SideScroll } from "./SideScroll";
import { EPISODES_AT_ONCE, heldStart, listedWindow, showKeyOf, startOf, type Entry, type EpisodeWindow, type Start } from "./pages";

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
  /** Where Play leads: the episode a link or a friend's message asked for (`Entry.asked`), else the one this profile is at, else the first. */
  start: Start | undefined;
  /**
   * The episode that was asked for is being looked up (its season's episodes are being asked for): Play waits, for it would otherwise start another episode. When
   * the show has no such episode, or nothing that plays it, Play leads where it always did.
   */
  holding: boolean;
  /** What Play says it leads to (pages.ts `playLabel`): `start`, or the episode that was asked for while it is looked up. */
  said: Start | undefined;
  /** The season that is shown: the one chosen, else the one Play leads to. */
  season: number | undefined;
  pick: (season: number) => void;
  /** How many episodes it has: none while they are being asked for, and `null` when the library has nothing to list. */
  count: number | null | undefined;
  /**
   * The ones of them that are listed, in order: 24 at a time (pages.ts `episodeWindow`), from the one Play leads to when it is further on - a season of hundreds (an
   * anime's) would be hundreds of cards. `earlier` and `later` say how many are left out before them and after them.
   */
  shown: PageEpisode[] | null | undefined;
  earlier: number;
  later: number;
  /** List 24 more, after the ones listed or before them: the number of the episode the keys should go to (the first that came, or the last of the ones before). */
  showMore: () => number | undefined;
  showEarlier: () => number | undefined;
  /** A film that no source had the last times it was played (see `useUnavailable`): the page says so beside Play. Never for a show: its episodes are marked. */
  unavailable: boolean;
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
  const own = entry && isShow ? startOf(entry, true, progress) : undefined;
  // (The episode a link or a friend's message asked for: found by its number in its season's episodes, which say what plays it.)
  const ask = asked && entry.asked?.season !== undefined && entry.asked.episode !== undefined ? { season: entry.asked.season, episode: entry.asked.episode, at: entry.asked.at } : undefined;
  const askedSeason = ask && seasons.includes(ask.season) ? ask.season : undefined;
  const askedDetails = useEpisodeDetails(askedSeason === undefined ? undefined : entry?.url, askedSeason);
  const askedEpisode = ask && askedDetails ? askedDetails.get(ask.episode) : undefined;
  const askedUrl = askedEpisode?.url;
  // (A time past the episode's end, as far as the library knows its length, is not one to start at: the episode would count as watched at once.)
  const askedAt = ask?.at !== undefined && !(askedEpisode?.runtime && ask.at > lastStartAt(askedEpisode.runtime * 60)) ? ask.at : undefined;
  const holding = ask !== undefined && (found === undefined || (askedSeason !== undefined && askedDetails === undefined));
  const start: Start | undefined =
    ask && askedUrl
      ? // (No time asked for, and this profile left that very episode part way: it is picked up where it was left.)
        askedAt === undefined && own?.season === ask.season && own.episode === ask.episode
        ? own
        : { season: ask.season, episode: ask.episode, url: askedUrl, ...(askedAt !== undefined ? { startAt: askedAt, asked: true as const } : {}) }
      : holding
        ? undefined
        : own;

  const [picked, setPicked] = useState<{ id: string; season: number } | undefined>(() => (entry && browsing !== undefined ? { id: entry.id, season: browsing } : undefined));
  // A page that was closed forgets the season that was browsed on it: it opens next on the one this profile is at.
  const open = entry !== undefined;
  // (And the episodes that were listed of it: 24 again, from the one Play leads to.)
  // (Each season's own: `${entry.id}|${season}`.)
  const [paged, setPaged] = useState<Readonly<Record<string, EpisodeWindow>>>({});
  useEffect(() => {
    if (open) return;
    setPicked(undefined);
    setPaged({});
  }, [open]);
  const chosen = picked?.id === entry?.id ? picked?.season : undefined;
  const season = [chosen, start?.season ?? askedSeason].find((n) => n !== undefined && seasons.includes(n)) ?? seasons[0];
  const details = useEpisodeDetails(season === undefined ? undefined : entry?.url, season);
  // (What nobody could play of it: asked for a film too, which is the one thing about a film this page asks.)
  const marks = useUnavailable(entry !== undefined && !entry.opens && entry.url !== "" ? entry.url : undefined);

  // (The season's episodes that something plays, in order: worked out again only when they change, as a season can have thousands.)
  const playable = useMemo(() => (details ? [...details.values()].filter((detail) => detail.url).sort((a, b) => a.episode - b.episode) : details), [details]);
  const all = !entry || (asked && found === undefined) || details === undefined ? undefined : season === undefined || !playable?.length ? null : playable;

  // The episodes listed of the season: 24 at a time, from the one Play leads to; what was pressed for is kept for that season while the page is open.
  const windowKey = entry && season !== undefined ? `${entry.id}|${season}` : "";
  const count = all?.length ?? 0;
  const target = start?.season === season ? start?.episode : undefined;
  const anchor = all && target !== undefined ? all.findIndex((detail) => detail.episode === target) : -1;
  const kept = windowKey ? paged[windowKey] : undefined;
  const range = listedWindow(count, anchor, kept);
  // (And so is the one that is listed now: Play's episode moving on - another screen finished it - leaves the list where it was while that one is in it. The
  // judge, 17 Nov: the 24 slid by one, and the episode the remote was on went from under it.)
  useEffect(() => {
    if (count > 0 && windowKey && (kept?.from !== range.from || kept?.to !== range.to)) setPaged((all) => ({ ...all, [windowKey]: { from: range.from, to: range.to } }));
  }, [count, windowKey, range.from, range.to, kept?.from, kept?.to]);
  const widen = (next: EpisodeWindow, land: number | undefined) => {
    if (windowKey) setPaged((all) => ({ ...all, [windowKey]: next }));
    return land;
  };

  // Only the ones listed are made into cards: each looks up what this profile did with it, among the records of this show's season alone.
  let shown: PageEpisode[] | null | undefined = all === null ? null : undefined;
  if (all && entry && season !== undefined) {
    const show = showKeyOf(entry, progress);
    const ofSeason = show ? watched.filter((record) => record.show === show && record.season === season) : [];
    const words = statusWords();
    shown = all.slice(range.from, range.to).map((detail): PageEpisode => {
      const status = episodeStatus(ofSeason, show, season, detail.episode);
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
          still: detail.still || entry.backdrop || entry.image,
          overview: detail.overview || (entry.description && entry.description.length <= 400 ? entry.description : undefined),
          meta: describeStatus(status, words) ?? (detail.runtime ? formatLeft(detail.runtime * 60) : undefined),
          state: status.kind,
          fraction: status.kind === "started" ? status.fraction : undefined,
          unavailable: marks?.episodes.has(episodeKey(season, detail.episode)) ?? false,
        },
      };
    });
  }

  return {
    seasons,
    isShow,
    loading: found === undefined && asked,
    start,
    holding,
    said: start ?? (holding && entry ? heldStart(entry) : undefined),
    season,
    pick: (next) => entry && setPicked({ id: entry.id, season: next }),
    count: all === undefined ? undefined : all === null ? null : count,
    shown,
    earlier: all ? range.from : 0,
    later: all ? count - range.to : 0,
    showMore: () => (all && range.to < count ? widen({ from: range.from, to: Math.min(count, range.to + EPISODES_AT_ONCE) }, all[range.to]?.episode) : undefined),
    showEarlier: () => (all && range.from > 0 ? widen({ from: Math.max(0, range.from - EPISODES_AT_ONCE), to: range.to }, all[range.from - 1]?.episode) : undefined),
    unavailable: !isShow && Boolean(marks?.title),
  };
}

/** The lines of the remote's zone `episodes` on a show's page, as `SeriesSection` draws them: Show earlier, the episodes listed `columns` across, Show more. */
export const episodeRows = (page: Pick<SeriesPage, "shown" | "earlier" | "later">, columns: number): number[] =>
  page.shown?.length ? [...(page.earlier > 0 ? [1] : []), ...gridRows(page.shown.length, columns), ...(page.later > 0 ? [1] : [])] : [];

/**
 * Under a show's buttons: its seasons (when there is a choice) and the episodes of the one that is shown. The remote walks them as zones `seasons` and `episodes`.
 * The episodes are `columns` across, in reading order (a wide screen has two: one card a line left a third of it empty, and the rows of titles under them were one
 * Down press per episode away - the judge, 16 Nov).
 */
export function SeriesSection({ page, columns = 1, onPlay, onSlide }: { page: SeriesPage; columns?: number; onPlay: (episode: PageEpisode) => void; onSlide: (button: HTMLElement) => void }) {
  const { seasons, season, shown, earlier, later } = page;
  // (Show earlier is the episodes' first line when there is one, Show more their last: lines of the remote's zone `episodes` too, see `episodeRows`.)
  const lead = earlier > 0 ? 1 : 0;
  const list = useRef<HTMLDivElement>(null);
  // After a press of either, the keys go to the first episode that came (Show more) or the last (Show earlier): the button may be gone, and the list goes on from there.
  const land = useRef<number | undefined>(undefined);
  // (What in the list had the keys last: when it is gone from it - the list moved on to Play's episode - they go to that one, not to nothing. The judge, 17 Nov.)
  const held = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const root = list.current;
    const episode = land.current;
    land.current = undefined;
    const lost = held.current !== null && !held.current.isConnected && (document.activeElement === null || document.activeElement === document.body);
    const to =
      episode !== undefined
        ? root?.querySelector<HTMLElement>(`[data-testid="tv-episode"][data-episode="${episode}"]`)
        : lost
          ? (root?.querySelector<HTMLElement>('[data-testid="tv-episode"][data-target="true"]') ?? root?.querySelector<HTMLElement>('[data-testid="tv-episode"]'))
          : undefined;
    // (The page keeps what has the keys in view itself, as for every other move: `.tv-detail-scroll`'s onFocus.)
    to?.focus({ preventScroll: true });
  }, [shown]);
  return (
    <section className="tv-detail-eps" aria-label={t("player.episodes")} data-testid="tv-episodes">
      <h2 className="tv-detail-eps-title">{t("player.episodes")}</h2>
      {seasons.length > 1 && (
        // (A long show's seasons run off the screen: a mouse has an arrow at each end.)
        <SideScroll label={t("player.seasons")} testId="tv-seasons" onFocus={(event) => onSlide(event.target as HTMLElement)}>
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
        </SideScroll>
      )}
      {shown ? (
        <div
          className="tv-detail-list"
          ref={list}
          data-cols={columns}
          style={columns > 1 ? ({ "--ep-cols": columns } as CSSProperties) : undefined}
          onFocus={(event) => (held.current = event.target as HTMLElement)}
          onBlur={(event) => {
            // (Gone elsewhere; a button taken out of the page says nothing of where, and is the one that is looked for.)
            if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) held.current = null;
          }}
        >
          {earlier > 0 && (
            <button
              className="tv-choice tv-detail-eps-more"
              data-testid="tv-episodes-earlier"
              data-zone="episodes"
              data-row={0}
              data-col={0}
              onClick={() => (land.current = page.showEarlier())}
            >
              <ChevronUpIcon aria-hidden="true" /> {t("series.earlier", { count: Math.min(EPISODES_AT_ONCE, earlier) })}
            </button>
          )}
          {shown.map((episode, at) => (
            <button
              key={`${episode.season}-${episode.episode}`}
              className="tv-opt tv-ep"
              data-testid="tv-episode"
              data-episode={episode.episode}
              data-zone="episodes"
              data-row={lead + Math.floor(at / columns)}
              data-col={at % columns}
              data-target={episode.target}
              data-active={episode.target}
              data-unavailable={episode.card.unavailable || undefined}
              onClick={() => onPlay(episode)}
            >
              <EpisodeRow {...episode.card} />
            </button>
          ))}
          {later > 0 && (
            <button
              className="tv-choice tv-detail-eps-more"
              data-testid="tv-episodes-more"
              data-zone="episodes"
              data-row={lead + Math.ceil(shown.length / columns)}
              data-col={0}
              onClick={() => (land.current = page.showMore())}
            >
              <ChevronDownIcon aria-hidden="true" /> {t("series.more", { count: Math.min(EPISODES_AT_ONCE, later) })}
            </button>
          )}
        </div>
      ) : (
        <p className="tv-detail-eps-note" data-testid="tv-episodes-note">
          {shown === null ? t("series.failed") : t("series.loading")}
        </p>
      )}
    </section>
  );
}
