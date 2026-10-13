import type { ReactNode } from "react";
import { listKey, savedKeys, type PlayHint } from "../../shared";
import { hintOf, listEntryOf, listName } from "../account/cards";
import type { ListEntry } from "../account/profileStore";
import { useRatingsOn } from "../account/ratings";
import { profileStore, useProfileData } from "../account/store";
import { useT } from "../i18n";
import { CheckIcon, PlayIcon, PlusIcon } from "../shared/icons";
import { Poster } from "../shared/Poster";
import { useSeriesPage, type PageEpisode, type SeriesPage } from "../tv/Episodes";
import { resumable, type Entry } from "../tv/pages";
import { RecommendButton } from "./Friends";
import { RatingBox } from "./RatingBox";
import { Sheet } from "./Sheet";
import { Still } from "./Sheets";

interface TitleSheetProps {
  /** The title as the library, a list or a card has it. */
  entry: Entry;
  /** Start something on the TV: a link, where to pick it up, and the picture and year the title is known by. A phone with no TV has none: the page is for the list, the rating and the rest. */
  onPlay?: (url: string, startAt: number | undefined, hint: PlayHint) => void;
  /** With more than one list: ask which one the title goes in. */
  onPick: (entry: ListEntry) => void;
  onClose: () => void;
}

/**
 * A title's own page on the phone, the way the TV has one: its picture, what it is about, Play (or Resume) and a list to keep it in,
 * and for a show its seasons and episodes. A tap on a title in the library or a list opens this instead of starting it at once.
 */
export function TitleSheet({ entry: given, onPlay, onPick, onClose }: TitleSheetProps) {
  const t = useT();
  const { progress, watched, lists, list } = useProfileData();
  const ratings = useRatingsOn();
  const entry = resumable(given, progress);
  const series = useSeriesPage(given, progress, watched);
  const hint = hintOf(entry);
  const play = onPlay ? (url: string, startAt?: number) => onPlay(new URL(url, location.href).href, startAt, hint) : undefined;

  const saved = savedKeys(list);
  const kept = lists.some((info) => saved.has(listKey(entry.url, info.id)));
  const several = lists.length > 1;

  const at = series.isShow ? series.start : undefined;
  const playLabel = at ? t(at.startAt !== undefined ? "series.resume" : "series.play", { season: at.season, episode: at.episode }) : entry.startAt !== undefined ? t("rows.resume") : t("rows.play");
  // The button says which list it is about, short enough to share a line with Play (the icon says whether the title is in it); what a tap does is its name for a screen reader.
  const listLabel = several ? t(kept ? "rows.inLists" : "library.addToAList") : t(kept ? "rows.removeFromList" : "library.addToList", { list: listName(lists[0]!) });
  const listText = several ? t("rows.myList") : listName(lists[0]!);
  const kind = entry.kind === "movie" ? t("library.kindMovie") : entry.kind === "series" ? t("library.kindSeries") : undefined;
  const meta = [entry.year, kind].filter(Boolean).join(" · ");

  return (
    <Sheet title={entry.title} onClose={onClose} testId="title-sheet">
      <Poster className="title-art" title={entry.title} image={entry.backdrop ?? entry.image} seed={entry.id} />
      {meta && (
        <p className="muted small" data-testid="title-meta">
          {meta}
        </p>
      )}
      <div className="title-actions">
        {play && (
          <button className="btn btn-red" data-testid="title-play" onClick={() => (at ? play(at.url, at.startAt) : play(entry.resumeUrl ?? entry.url, entry.startAt))}>
            <PlayIcon /> {playLabel}
          </button>
        )}
        <button
          className="btn"
          data-testid="title-list"
          aria-pressed={kept}
          aria-haspopup={several ? "dialog" : undefined}
          aria-label={listLabel}
          onClick={() => (several ? onPick(listEntryOf(entry)) : profileStore.setInList(listEntryOf(entry), !kept))}
        >
          {kept ? <CheckIcon /> : <PlusIcon />} {listText}
        </button>
      </div>
      <RecommendButton entry={entry} />
      {ratings && <RatingBox entry={entry} isShow={series.isShow} title={t("rating.yours")} testId="rate-title" />}
      {entry.description && <p className="muted title-about">{entry.description}</p>}
      {series.isShow && (
        <Episodes
          page={series}
          {...(play ? { onPlay: (episode: PageEpisode) => play(episode.url, episode.startAt) } : {})}
          seasonRating={
            ratings && series.season !== undefined ? (
              <RatingBox key={series.season} entry={entry} isShow season={series.season} total={series.episodes?.length} title={t("rating.seasonRating", { n: series.season })} testId="rate-season" />
            ) : undefined
          }
        />
      )}
    </Sheet>
  );
}

/** A show's seasons (when there is a choice) and the episodes of the one that is shown, each a card the way the episode sheet lists them. */
function Episodes({ page, onPlay, seasonRating }: { page: SeriesPage; /** None on a phone with no TV: the episodes are then only to read. */ onPlay?: (episode: PageEpisode) => void; /** The rating box of the season that is shown. */ seasonRating?: ReactNode }) {
  const t = useT();
  const { seasons, season, episodes } = page;
  const Row = onPlay ? "button" : "div";
  return (
    <section className="title-episodes" aria-label={t("player.episodes")} data-testid="title-episodes">
      <h3 className="sheet-section">{t("player.episodes")}</h3>
      {seasons.length > 1 && (
        <div className="seasons" role="tablist" aria-label={t("player.seasons")}>
          {seasons.map((number) => (
            <button
              key={number}
              role="tab"
              aria-selected={number === season}
              className={`season ${number === season ? "active" : ""}`}
              data-testid={`title-season-${number}`}
              onClick={() => page.pick(number)}
            >
              {t("player.season", { n: number })}
            </button>
          ))}
        </div>
      )}
      {seasonRating}
      {episodes ? (
        <ul className="episodes">
          {episodes.map((episode) => {
            const card = episode.card;
            return (
              <li key={`${episode.season}-${episode.episode}`}>
                <Row
                  className="episode rich"
                  data-testid="title-episode"
                  data-season={episode.season}
                  data-episode={episode.episode}
                  data-target={episode.target}
                  data-status={card.state}
                  {...(onPlay ? { onClick: () => onPlay(episode) } : {})}
                >
                  <span className="episode-no">{card.number}</span>
                  <Still src={card.still} name={card.name} />
                  <span className="episode-text">
                    <span className="episode-title">{card.name}</span>
                    {card.meta && (
                      <span className="episode-meta">
                        <span className={`episode-note ${card.state}`}>
                          {card.state === "watched" && <CheckIcon />} {card.meta}
                        </span>
                      </span>
                    )}
                    {card.overview && <span className="episode-about">{card.overview}</span>}
                  </span>
                  {card.fraction !== undefined && (
                    <span className="episode-progress" aria-hidden="true">
                      <i style={{ width: `${Math.round(card.fraction * 100)}%` }} />
                    </span>
                  )}
                </Row>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small" data-testid="title-episodes-note">
          {episodes === null ? t("series.failed") : t("series.loading")}
        </p>
      )}
    </section>
  );
}
