import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, useCallback, type FocusEventHandler, type ReactNode } from "react";
import type { LiveProgress, LiveWatched } from "../../shared";
import { describeStatus, episodeName, episodeStatus, lastStartAt } from "../../shared";
import { t } from "../i18n";
import { useEpisodeDetails, useSeasons } from "../shared/episodeDetails";
import { formatLeft } from "../shared/format";
import { ChevronDownIcon, ChevronUpIcon, ChevronIcon, ChevronLeftIcon } from "../shared/icons";
import { gridRows } from "./browseNav";
import { episodeKey, useUnavailable } from "../shared/unavailable";
import { statusWords } from "../shared/words";
import { digitsStyle, EpisodeRow, type EpisodeCard } from "./EpisodeRow";
import { EPISODES_AT_ONCE, heldStart, listedWindow, showKeyOf, startOf, type Entry, type EpisodeWindow, type Start } from "./pages";

const STEP = 0.8;
function SideScroll({ children, label, onFocus, testId }: { children: ReactNode; label: string; onFocus?: FocusEventHandler<HTMLDivElement>; testId: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ before: false, after: false });

  const measure = useCallback(() => {
    const row = scroller.current;
    if (!row) return;
    const before = row.scrollLeft > 2;
    const after = row.scrollLeft < row.scrollWidth - row.clientWidth - 2;
    setMore((was) => (was.before === before && was.after === after ? was : { before, after }));
  }, []);

  useEffect(measure);
  useEffect(() => {
    const row = scroller.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(row);
    return () => watch.disconnect();
  }, [measure]);

  const go = (direction: -1 | 1) => scroller.current?.scrollBy({ left: direction * scroller.current.clientWidth * STEP, behavior: "smooth" });
  const arrow = (side: "before" | "after") => (
    <button
      type="button"
      className="tv-filters-more"
      data-side={side}
      data-testid={`${testId}-${side === "before" ? "back" : "next"}`}
      tabIndex={-1}
      aria-hidden="true"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => go(side === "before" ? -1 : 1)}
    >
      {side === "before" ? <ChevronLeftIcon /> : <ChevronIcon />}
    </button>
  );
  return (
    <div className="tv-filters-box" data-more-before={more.before || undefined} data-more-after={more.after || undefined}>
      <div className="tv-filters" ref={scroller} role="radiogroup" aria-label={label} data-testid={testId} onScroll={measure} onFocus={onFocus}>
        {children}
      </div>
      {more.before && arrow("before")}
      {more.after && arrow("after")}
    </div>
  );
}

export interface PageEpisode {
  season: number;
  episode: number;
  url: string;
  startAt?: number;
  target: boolean;
  card: EpisodeCard;
}

export interface SeriesPage {
  seasons: number[];
  isShow: boolean;
  loading: boolean;
  start: Start | undefined;
  holding: boolean;
  said: Start | undefined;
  season: number | undefined;
  pick: (season: number) => void;
  count: number | null | undefined;
  shown: PageEpisode[] | null | undefined;
  earlier: number;
  later: number;
  showMore: () => number | undefined;
  showEarlier: () => number | undefined;
  unavailable: boolean;
}

export function useSeriesPage(entry: Entry | undefined, progress: readonly LiveProgress[], watched: readonly LiveWatched[], browsing?: number): SeriesPage {
  const asked = entry !== undefined && !entry.opens && entry.url !== "" && entry.kind !== "movie";
  const found = useSeasons(asked ? entry.url : undefined);
  const seasons = found ?? [];
  const isShow = entry?.kind === "series" || seasons.length > 0;
  const own = entry && isShow ? startOf(entry, true, progress) : undefined;
  const ask = asked && entry.asked?.season !== undefined && entry.asked.episode !== undefined ? { season: entry.asked.season, episode: entry.asked.episode, at: entry.asked.at } : undefined;
  const askedSeason = ask && seasons.includes(ask.season) ? ask.season : undefined;
  const askedDetails = useEpisodeDetails(askedSeason === undefined ? undefined : entry?.url, askedSeason);
  const askedEpisode = ask && askedDetails ? askedDetails.get(ask.episode) : undefined;
  const askedUrl = askedEpisode?.url;
  const askedAt = ask?.at !== undefined && !(askedEpisode?.runtime && ask.at > lastStartAt(askedEpisode.runtime * 60)) ? ask.at : undefined;
  const holding = ask !== undefined && (found === undefined || (askedSeason !== undefined && askedDetails === undefined));
  const start: Start | undefined =
    ask && askedUrl
      ?
        askedAt === undefined && own?.season === ask.season && own.episode === ask.episode
        ? own
        : { season: ask.season, episode: ask.episode, url: askedUrl, ...(askedAt !== undefined ? { startAt: askedAt, asked: true as const } : {}) }
      : holding
        ? undefined
        : own;

  const [picked, setPicked] = useState<{ id: string; season: number } | undefined>(() => (entry && browsing !== undefined ? { id: entry.id, season: browsing } : undefined));
  const open = entry !== undefined;
  const [paged, setPaged] = useState<Readonly<Record<string, EpisodeWindow>>>({});
  useEffect(() => {
    if (open) return;
    setPicked(undefined);
    setPaged({});
  }, [open]);
  const chosen = picked?.id === entry?.id ? picked?.season : undefined;
  const season = [chosen, start?.season ?? askedSeason].find((n) => n !== undefined && seasons.includes(n)) ?? seasons[0];
  const details = useEpisodeDetails(season === undefined ? undefined : entry?.url, season);
  const marks = useUnavailable(entry !== undefined && !entry.opens && entry.url !== "" ? entry.url : undefined);

  const playable = useMemo(() => (details ? [...details.values()].filter((detail) => detail.url).sort((a, b) => a.episode - b.episode) : details), [details]);
  const all = !entry || (asked && found === undefined) || details === undefined ? undefined : season === undefined || !playable?.length ? null : playable;

  const windowKey = entry && season !== undefined ? `${entry.id}|${season}` : "";
  const count = all?.length ?? 0;
  const target = start?.season === season ? start?.episode : undefined;
  const anchor = all && target !== undefined ? all.findIndex((detail) => detail.episode === target) : -1;
  const kept = windowKey ? paged[windowKey] : undefined;
  const range = listedWindow(count, anchor, kept);
  useEffect(() => {
    if (count > 0 && windowKey && (kept?.from !== range.from || kept?.to !== range.to)) setPaged((all) => ({ ...all, [windowKey]: { from: range.from, to: range.to } }));
  }, [count, windowKey, range.from, range.to, kept?.from, kept?.to]);
  const widen = (next: EpisodeWindow, land: number | undefined) => {
    if (windowKey) setPaged((all) => ({ ...all, [windowKey]: next }));
    return land;
  };

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

export const episodeRows = (page: Pick<SeriesPage, "shown" | "earlier" | "later">, columns: number): number[] =>
  page.shown?.length ? [...(page.earlier > 0 ? [1] : []), ...gridRows(page.shown.length, columns), ...(page.later > 0 ? [1] : [])] : [];

export function SeriesSection({ page, columns = 1, onPlay, onSlide }: { page: SeriesPage; columns?: number; onPlay: (episode: PageEpisode) => void; onSlide: (button: HTMLElement) => void }) {
  const { seasons, season, shown, earlier, later } = page;
  const lead = earlier > 0 ? 1 : 0;
  const list = useRef<HTMLDivElement>(null);
  const land = useRef<number | undefined>(undefined);
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
    to?.focus({ preventScroll: true });
  }, [shown]);
  return (
    <section className="tv-detail-eps" aria-label={t("player.episodes")} data-testid="tv-episodes">
      <h2 className="tv-detail-eps-title">{t("player.episodes")}</h2>
      {seasons.length > 1 && (
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
          style={columns > 1 ? ({ "--ep-cols": columns, ...digitsStyle(shown) } as CSSProperties) : digitsStyle(shown)}
          onFocus={(event) => (held.current = event.target as HTMLElement)}
          onBlur={(event) => {
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
