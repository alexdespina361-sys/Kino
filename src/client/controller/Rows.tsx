import type { ReactNode } from "react";
import { fractionOf, listOf, resumeAt, type ListInfo, type LiveListItem, type LiveProgress, type LiveRating, type PlayHint } from "../../shared";
import { continueNote, hintOf, listEntryOf, listName, unfinished } from "../account/cards";
import type { ListEntry } from "../account/profileStore";
import { ratingNote, scoreOf, sortRatings } from "../account/ratingText";
import { useScores } from "../account/ratings";
import { useT } from "../i18n";
import { Poster } from "../shared/Poster";
import { ScoreBadge } from "../shared/ScoreBadge";
import { entryOfRating, entryOfSaved, type Entry } from "../tv/pages";
import { useHold } from "./hold";
import { ListButton, RemoveButton, useListToggle, type ListToggle } from "./Round";

/**
 * A heading (with something small at its far end, if need be) and a row of cards that scrolls sideways, to the screen's edge. `wide`:
 * big cards that snap one at a time, the next one showing at the edge (the row of what is half watched).
 */
export function CardRow({ title, testId, aside, wide, children }: { title: string; testId: string; aside?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`lib-row${wide ? " is-wide" : ""}`} data-testid={testId} aria-label={title}>
      <RowHead title={title} aside={aside} />
      <div className="lib-scroller">{children}</div>
    </section>
  );
}

function RowHead({ title, aside }: { title: string; aside?: ReactNode }) {
  if (!aside) return <h3>{title}</h3>;
  return (
    <div className="lib-row-head">
      <h3>{title}</h3>
      {aside}
    </div>
  );
}

interface CardProps {
  title: string;
  image?: string | undefined;
  /** A line under the title: the episode, what is left. */
  note?: string | undefined;
  /** 0..1: a thin bar across the foot of the picture. */
  progress?: number;
  /** The score this profile gave the title, in the picture's corner. */
  score?: number | undefined;
  playLabel: string;
  /** The cross in the corner: a card that cannot be taken off its row (a rated title's) has neither of these. */
  removeLabel?: string;
  onPlay: () => void;
  onRemove?: () => void;
  testId: string;
  /** The round + beside the cross, which a hold on the card does as well. */
  toggle?: ListToggle;
  /** What a hold on the card does when there is no + on it. */
  onHold?: () => void;
}

export function Card({ title, image, note, progress = 0, score, playLabel, removeLabel, onPlay, onRemove, testId, toggle, onHold }: CardProps) {
  const hold = useHold(() => (onHold ?? toggle?.onHold)?.());
  return (
    <div className="lib-tile" data-testid={`${testId}-item`}>
      <button className="lib-card" onClick={hold.tap(onPlay)} {...hold.props} aria-label={playLabel} data-testid={`${testId}-play`}>
        <Poster className="lib-art" title={title} image={image}>
          {score !== undefined && <ScoreBadge score={score} />}
          {progress > 0 && (
            <span className="lib-progress" aria-hidden="true">
              <i style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
          )}
        </Poster>
        <span className="lib-title">{title}</span>
        {note && <span className="lib-year">{note}</span>}
      </button>
      {(toggle || onRemove) && (
        <span className="lib-corner">
          {toggle && <ListButton toggle={toggle} title={title} testId={`${testId}-list-toggle`} />}
          {onRemove && <RemoveButton label={removeLabel ?? ""} onClick={onRemove} testId={`${testId}-remove`} />}
        </span>
      )}
    </div>
  );
}

/**
 * "Continue watching": the cards of what this profile started, newest first, big and one at a time. Tapping one picks it up where it
 * stopped; the + on it (or a hold) puts the title in a list, and the cross takes it off the row.
 */
export function ContinueRow({
  items,
  onPlay,
  onRemove,
  onPick,
}: {
  items: readonly LiveProgress[];
  onPlay: (url: string, startAt: number | undefined, hint: PlayHint) => void;
  onRemove: (key: string) => void;
  onPick: (entry: ListEntry) => void;
}) {
  const t = useT();
  const toggleFor = useListToggle(onPick);
  const scores = useScores();
  const shown = unfinished(items);
  if (shown.length === 0) return null;
  return (
    <CardRow title={t("rows.continue")} testId="continue-row" wide>
      {shown.map((item) => {
        const resume = resumeAt(item);
        return (
          <Card
            key={item.key}
            testId="continue"
            title={item.title}
            image={item.backdrop ?? item.image}
            note={continueNote(item)}
            progress={fractionOf(item)}
            score={scoreOf(scores, item.url)}
            playLabel={`${resume === undefined ? t("rows.play") : t("rows.resume")} ${item.title}`}
            removeLabel={`${t("rows.remove")}: ${item.title}`}
            onPlay={() => onPlay(item.url, resume, hintOf(item))}
            onRemove={() => onRemove(item.key)}
            toggle={toggleFor(listEntryOf({ id: item.key, title: item.title, url: item.url, image: item.image, backdrop: item.backdrop, year: item.year }))}
          />
        );
      })}
    </CardRow>
  );
}

interface ListRowsProps {
  lists: readonly ListInfo[];
  items: readonly LiveListItem[];
  /** A tap on a title: its page opens. */
  onOpen: (entry: Entry) => void;
  /** With more than one list, a hold on a title asks which lists it is in. */
  onPick: (entry: ListEntry) => void;
  onRemove: (url: string, list: string) => void;
  /** Open the sheet where lists are made, renamed and deleted. */
  onManage: () => void;
}

/**
 * The lists this profile keeps: a row for each that has a title in it, named as the list is, the titles saved for later. The first
 * row has the way to the lists themselves; when there are several lists and all are empty the way is there on its own, and until
 * the first title is saved (one list, empty) there is nothing at all.
 */
export function ListRows({ lists, items, onOpen, onPick, onRemove, onManage }: ListRowsProps) {
  const t = useT();
  const scores = useScores();
  const filled = lists.filter((info) => items.some((item) => listOf(item) === info.id));
  if (filled.length === 0 && lists.length < 2) return null;
  const manage = (
    <button type="button" className="row-link" onClick={onManage} data-testid="lists-manage">
      {t("lists.manage")}
    </button>
  );
  if (filled.length === 0) {
    return (
      <section className="lib-row" data-testid="list-row" aria-label={t("rows.myList")}>
        <RowHead title={t("rows.myList")} aside={manage} />
        <p className="muted small">{t("rows.myListEmpty")}</p>
      </section>
    );
  }
  return (
    <>
      {filled.map((info, index) => {
        const name = listName(info);
        return (
          <CardRow key={info.id} title={name} testId="list-row" aside={index === 0 ? manage : undefined}>
            {items
              .filter((item) => listOf(item) === info.id)
              .map((item) => (
                <Card
                  key={item.key}
                  testId="list"
                  title={item.title}
                  image={item.backdrop ?? item.image}
                  note={item.year ? String(item.year) : undefined}
                  score={scoreOf(scores, item.url)}
                  playLabel={`${t("rows.open")} ${item.title}`}
                  removeLabel={`${t("rows.removeFromList", { list: name })}: ${item.title}`}
                  onPlay={() => onOpen(entryOfSaved(item))}
                  onRemove={() => onRemove(item.url, info.id)}
                  {...(lists.length > 1 ? { onHold: () => onPick(listEntryOf(item)) } : {})}
                />
              ))}
          </CardRow>
        );
      })}
    </>
  );
}

/**
 * What this profile rated: a row of the titles and seasons it gave a score, the newest first, with the score under each. A tap opens
 * the title (where its rating, note and stats are); "See all" opens the whole list. There is no row until something is rated.
 */
export function RatingsRow({ ratings, onOpen, onAll }: { ratings: readonly LiveRating[]; onOpen: (entry: Entry) => void; onAll: () => void }) {
  const t = useT();
  if (ratings.length === 0) return null;
  const all = (
    <button type="button" className="row-link" onClick={onAll} data-testid="ratings-all">
      {t("rating.all")}
    </button>
  );
  return (
    <CardRow title={t("rating.mine")} testId="ratings-row" aside={all}>
      {sortRatings(ratings, "new").map((rating) => (
        <Card key={rating.key} testId="rating" title={rating.title} image={rating.backdrop ?? rating.image} note={ratingNote(t, rating)} playLabel={`${t("rows.open")} ${rating.title}`} onPlay={() => onOpen(entryOfRating(rating))} />
      ))}
    </CardRow>
  );
}