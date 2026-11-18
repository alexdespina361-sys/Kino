import type { ReactNode } from "react";
import { fractionOf, listOf, resumeAt, type ListInfo, type LiveListItem, type LiveProgress, type LiveRating, type PlayHint } from "../../shared";
import { continueNote, hintOf, listEntryOf, listName, unfinished } from "../account/cards";
import type { ListEntry } from "../account/profileStore";
import { ratingNote, scoreOf, sortRatings } from "../account/ratingText";
import { useScores } from "../account/ratings";
import { useT } from "../i18n";
import { Poster } from "../shared/Poster";
import { ScoreBadge, useScoreWords } from "../shared/ScoreBadge";
import { entryOfRating, entryOfSaved, type Entry } from "../tv/pages";
import { useHold } from "./hold";
import { RemoveButton, SavedMark, useListToggle, type ListToggle } from "./Round";

export function CardRow({ title, testId, aside, wide, children }: { title: string; testId: string; aside?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`lib-row${wide ? " is-wide" : ""}`} data-testid={testId} aria-label={title}>
      <RowHead title={title} aside={aside} />
      <div className="lib-scroller">{children}</div>
    </section>
  );
}

export function RowHead({ title, aside }: { title: string; aside?: ReactNode }) {
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
  note?: string | undefined;
  progress?: number;
  score?: number | undefined;
  playLabel: string;
  removeLabel?: string;
  onPlay: () => void;
  onRemove?: () => void;
  testId: string;
  toggle?: ListToggle;
  onHold?: () => void;
}

export function Card({ title, image, note, progress = 0, score, playLabel, removeLabel, onPlay, onRemove, testId, toggle, onHold }: CardProps) {
  const hold = useHold(() => (onHold ?? toggle?.onHold)?.());
  const scoreWords = useScoreWords();
  return (
    <div className="lib-tile" data-testid={`${testId}-item`} data-in-list={toggle?.inList}>
      <button className="lib-card" onClick={hold.tap(onPlay)} {...hold.props} aria-label={score === undefined ? playLabel : `${playLabel}. ${scoreWords(score)}`} data-testid={`${testId}-play`}>
        <Poster className="lib-art" title={title} image={image}>
          {score !== undefined && <ScoreBadge score={score} />}
          {toggle?.inList && !onRemove && <SavedMark />}
          {progress > 0 && (
            <span className="lib-progress" aria-hidden="true">
              <i style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
          )}
        </Poster>
        <span className="lib-title">{title}</span>
        {note && <span className="lib-year">{note}</span>}
      </button>
      {onRemove && (
        <span className="lib-corner">
          <RemoveButton label={removeLabel ?? ""} onClick={onRemove} testId={`${testId}-remove`} />
        </span>
      )}
    </div>
  );
}

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
  onOpen: (entry: Entry) => void;
  onPick: (entry: ListEntry) => void;
  onRemove: (url: string, list: string) => void;
  onManage: () => void;
}

export function hasListRows(lists: readonly ListInfo[], items: readonly LiveListItem[]): boolean {
  return lists.length >= 2 || lists.some((info) => items.some((item) => listOf(item) === info.id));
}

export function ListRows({ lists, items, onOpen, onPick, onRemove, onManage }: ListRowsProps) {
  const t = useT();
  const scores = useScores();
  const filled = lists.filter((info) => items.some((item) => listOf(item) === info.id));
  if (!hasListRows(lists, items)) return null;
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
                  image={item.image ?? item.backdrop}
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
        <Card key={rating.key} testId="rating" title={rating.title} image={rating.image ?? rating.backdrop} note={ratingNote(t, rating)} playLabel={`${t("rows.open")} ${rating.title}`} onPlay={() => onOpen(entryOfRating(rating))} />
      ))}
    </CardRow>
  );
}