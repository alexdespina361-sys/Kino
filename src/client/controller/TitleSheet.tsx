import type { ReactNode } from "react";
import { forChildren, type PlayHint } from "../../shared";
import { hintOf, listEntryOf, listName } from "../account/cards";
import type { ListEntry } from "../account/profileStore";
import { scoreOf, useRatingsOn, useScores } from "../account/ratings";
import { useProfileData } from "../account/store";
import { useT } from "../i18n";
import { aboutRows, useAbout } from "../shared/about";
import { AboutFacts, AboutPeople } from "../shared/AboutFacts";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, ListIcon, PlayIcon, PlusIcon } from "../shared/icons";
import { Poster } from "../shared/Poster";
import { useSeriesPage, type PageEpisode, type SeriesPage } from "../tv/Episodes";
import { entryOfItem, EPISODES_AT_ONCE, playLabel, resumable, type Entry } from "../tv/pages";
import { Page } from "./AccountScreen";
import { RecommendButton } from "./Friends";
import { Tile } from "./Library";
import { RatingBox } from "./RatingBox";
import { useListToggle } from "./Round";
import { Still } from "./Sheets";

interface TitleSheetProps {
  /** The title as the library, a list or a card has it. */
  entry: Entry;
  /** Start something on the TV: a link, where to pick it up, and the picture and year the title is known by. A phone with no TV has none: the page is for the list, the rating and the rest. */
  onPlay?: (url: string, startAt: number | undefined, hint: PlayHint) => void;
  /** With more than one list: ask which one the title goes in ("Other lists", or the list button of a title that is in another list). */
  onPick: (entry: ListEntry) => void;
  /** A tap on a title of the rows under the page (the other parts of its collection, titles like it): that title's page opens in place of this one. */
  onOpenTitle: (entry: Entry) => void;
  onClose: () => void;
}

/**
 * A title's own page on the phone, the way the TV has one: its picture, what it is about, Play (or Resume) and a list to keep it in,
 * and for a show its seasons and episodes. A tap on a title in the library or a list opens this instead of starting it at once.
 * It is a page (the whole screen, a round way back over its picture), not a sheet that leaves a strip of the page behind it showing.
 * What the movie database knows of the title (its genres and age rating, who made it, who is in it, and the rows of the titles that go with it) is asked for when the page opens, and added under what it is about when it comes.
 */
export function TitleSheet({ entry: given, onPlay, onPick, onOpenTitle, onClose }: TitleSheetProps) {
  const t = useT();
  const { progress, watched, lists, settings } = useProfileData();
  const ratings = useRatingsOn();
  const scores = useScores();
  const toggleFor = useListToggle(onPick);
  const entry = resumable(given, progress);
  const series = useSeriesPage(given, progress, watched);
  const about = useAbout(!entry.opens && entry.url !== "" ? entry.url : undefined);
  // (A child's profile is shown, of the titles that go with this one, only those for children.)
  const child = settings.child === true;
  const related = aboutRows(about)
    .map((row) => (child ? { ...row, items: row.items.filter((item) => forChildren(item)) } : row))
    .filter((row) => row.items.length > 0);
  const hint = hintOf(entry);
  const play = onPlay ? (url: string, startAt?: number) => onPlay(new URL(url, location.href).href, startAt, hint) : undefined;

  // One tap for the main list (in it, or out of it); with several lists, "Other lists" beside it opens the picker, whatever lists the title is in, so that nothing moves.
  const toggle = toggleFor(listEntryOf(entry));
  const several = lists.length > 1;

  const at = series.isShow ? series.start : undefined;
  // (Play waits while the episode a friend's message asked for is looked up: it would start another one.)
  const holding = series.isShow && series.holding;
  const label = playLabel(entry, series.isShow ? series.said : undefined);
  // The button says which list it is about, short enough to share a line with Play (the icon says whether the title is in it); what a tap does is its name for a screen reader.
  const listLabel = toggle.asks ? t("rows.inLists") : t(toggle.inList ? "rows.removeFromList" : "library.addToList", { list: listName(lists[0]!) });
  const listText = toggle.asks ? t("rows.myList") : listName(lists[0]!);
  const kind = entry.kind === "movie" ? t("library.kindMovie") : entry.kind === "series" ? t("library.kindSeries") : undefined;
  const meta = [entry.year, kind].filter(Boolean).join(" · ");

  return (
    <Page title={entry.title} onBack={onClose} testId="title-sheet" backTestId="title-back" bare>
      {/* (the picture over a column of what is done with the title; held sideways, the picture beside it: see the wrappers in the style sheets) */}
      <div className="title-top">
        <Poster className="title-art" title={entry.title} image={entry.backdrop ?? entry.image} seed={entry.id} />
        <div className="title-main">
          <h2 className="title-name" data-testid="title-name">
            {entry.title}
          </h2>
          {meta && (
            <p className="muted small" data-testid="title-meta">
              {meta}
            </p>
          )}
          <div className="title-actions">
            {play && (
              <button
                className="btn btn-red title-play"
                data-testid="title-play"
                aria-disabled={holding || undefined}
                onClick={() => (holding ? undefined : at ? play(at.url, at.startAt) : play(entry.resumeUrl ?? entry.url, entry.startAt))}
              >
                <PlayIcon /> {label}
              </button>
            )}
            <div className="title-secondary">
              <button className="btn" data-testid="title-list" aria-pressed={toggle.inList} aria-haspopup={toggle.asks ? "dialog" : undefined} aria-label={listLabel} onClick={toggle.onClick}>
                {toggle.inList ? <CheckIcon /> : <PlusIcon />} {listText}
              </button>
              {several && (
                <button className="btn" data-testid="title-lists" aria-haspopup="dialog" onClick={() => onPick(listEntryOf(entry))}>
                  <ListIcon /> {t("rows.otherLists")}
                </button>
              )}
              <RecommendButton entry={entry} />
            </div>
          </div>
          {/* (Under the buttons: the answer comes after the page has opened, and must not move Play.) */}
          {series.unavailable && (
            <p className="title-gone" data-testid="title-unavailable">
              {t("library.unavailableFilm")}
            </p>
          )}
          {ratings && <RatingBox entry={entry} isShow={series.isShow} title={t("rating.yours")} testId="rate-title" quick />}
          {entry.description && <p className="muted title-about">{entry.description}</p>}
          {about && <AboutFacts about={about} hasRoDub={entry.hasRoDub || about.hasRoDub} />}
          {about && <AboutPeople about={about} />}
        </div>
      </div>
      {series.isShow && (
        <Episodes
          page={series}
          {...(play ? { onPlay: (episode: PageEpisode) => play(episode.url, episode.startAt) } : {})}
          seasonRating={
            ratings && series.season !== undefined ? (
              <RatingBox key={series.season} entry={entry} isShow season={series.season} total={series.count ?? undefined} title={t("rating.seasonRating", { n: series.season })} testId="rate-season" />
            ) : undefined
          }
        />
      )}
      {related.map((row) => (
        <section className="lib-row title-more" key={`${entry.id}-${row.id}`} aria-label={t(`about.${row.id}`)} data-testid={`title-about-${row.id}`}>
          <h3>{t(`about.${row.id}`)}</h3>
          <div className="lib-scroller">
            {row.items.map((item) => (
              <Tile key={item.id} item={item} score={scoreOf(scores, item.url)} toggle={toggleFor(listEntryOf(item))} onOpen={() => onOpenTitle(entryOfItem(item))} />
            ))}
          </div>
        </section>
      ))}
    </Page>
  );
}

/** A show's seasons (when there is a choice) and the episodes of the one that is shown, each a card the way the episode sheet lists them. */
function Episodes({ page, onPlay, seasonRating }: { page: SeriesPage; /** None on a phone with no TV: the episodes are then only to read. */ onPlay?: (episode: PageEpisode) => void; /** The rating box of the season that is shown. */ seasonRating?: ReactNode }) {
  const t = useT();
  const { seasons, season, shown: episodes, earlier, later } = page;
  const Row = onPlay ? "button" : "div";
  // (24 at a time, from the one Play leads to: see `SeriesPage.shown`. Show earlier adds the ones before above, and the page keeps its place under the finger.)
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
      {episodes && earlier > 0 && (
        <button type="button" className="btn btn-block episodes-more" onClick={() => page.showEarlier()} data-testid="title-episodes-earlier">
          <ChevronUpIcon aria-hidden="true" /> {t("series.earlier", { count: Math.min(EPISODES_AT_ONCE, earlier) })}
        </button>
      )}
      {episodes ? (
        <ul className="episodes">
          {episodes.map((episode) => {
            const card = episode.card;
            const isRich = Boolean(card.still || card.overview);
            return (
              <li key={`${episode.season}-${episode.episode}`}>
                <Row
                  className={`episode${isRich ? " rich" : ""}`}
                  data-testid="title-episode"
                  data-season={episode.season}
                  data-episode={episode.episode}
                  data-target={episode.target}
                  data-status={card.state}
                  data-unavailable={card.unavailable || undefined}
                  {...(onPlay ? { onClick: () => onPlay(episode) } : {})}
                >
                  <span className="episode-no">{card.number}</span>
                  {isRich && <Still src={card.still} name={card.name} />}
                  <span className="episode-text">
                    <span className="episode-title">{card.name}</span>
                    {card.meta && (
                      <span className="episode-meta">
                        <span className={`episode-note ${card.state}`}>
                          {card.state === "watched" && <CheckIcon />} {card.meta}
                        </span>
                      </span>
                    )}
                    {card.unavailable && (
                      <span className="episode-gone" data-testid="episode-unavailable">
                        {t("library.unavailable")}
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
      {episodes && later > 0 && (
        <button type="button" className="btn btn-block episodes-more" onClick={() => page.showMore()} data-testid="title-episodes-more">
          <ChevronDownIcon aria-hidden="true" /> {t("series.more", { count: Math.min(EPISODES_AT_ONCE, later) })}
        </button>
      )}
    </section>
  );
}
