import type { ReactNode } from "react";
import { fractionOf, listOf, resumeAt, type ListInfo, type LiveListItem, type LiveProgress, type PlayHint } from "../../shared";
import { continueNote, hintOf, listName, unfinished } from "../account/cards";
import { useT } from "../i18n";
import { CloseIcon } from "../shared/icons";
import { Poster } from "../shared/Poster";

/** A heading (with something small at its far end, if need be) and a row of cards that scrolls sideways, to the screen's edge. */
export function CardRow({ title, testId, aside, children }: { title: string; testId: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="lib-row" data-testid={testId} aria-label={title}>
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
  playLabel: string;
  removeLabel: string;
  onPlay: () => void;
  onRemove: () => void;
  testId: string;
}

function Card({ title, image, note, progress = 0, playLabel, removeLabel, onPlay, onRemove, testId }: CardProps) {
  return (
    <div className="lib-tile has-remove" data-testid={`${testId}-item`}>
      <button className="lib-card" onClick={onPlay} aria-label={playLabel} data-testid={`${testId}-play`}>
        <Poster className="lib-art" title={title} image={image}>
          {progress > 0 && (
            <span className="lib-progress" aria-hidden="true">
              <i style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
          )}
        </Poster>
        <span className="lib-title">{title}</span>
        {note && <span className="lib-year">{note}</span>}
      </button>
      <button className="lib-remove" onClick={onRemove} aria-label={removeLabel} data-testid={`${testId}-remove`}>
        <CloseIcon />
      </button>
    </div>
  );
}

/** "Continue watching": the cards of what this profile started, newest first. Tapping one picks it up where it stopped. */
export function ContinueRow({ items, onPlay, onRemove }: { items: readonly LiveProgress[]; onPlay: (url: string, startAt: number | undefined, hint: PlayHint) => void; onRemove: (key: string) => void }) {
  const t = useT();
  const shown = unfinished(items);
  if (shown.length === 0) return null;
  return (
    <CardRow title={t("rows.continue")} testId="continue-row">
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
            playLabel={`${resume === undefined ? t("rows.play") : t("rows.resume")} ${item.title}`}
            removeLabel={`${t("rows.remove")}: ${item.title}`}
            onPlay={() => onPlay(item.url, resume, hintOf(item))}
            onRemove={() => onRemove(item.key)}
          />
        );
      })}
    </CardRow>
  );
}

interface ListRowsProps {
  lists: readonly ListInfo[];
  items: readonly LiveListItem[];
  onPlay: (url: string, hint: PlayHint) => void;
  onRemove: (url: string, list: string) => void;
  /** Open the sheet where lists are made, renamed and deleted. */
  onManage: () => void;
}

/**
 * The lists this profile keeps: a row for each that has a title in it, named as the list is, the titles saved for later. The first
 * row has the way to the lists themselves; when there are several lists and all are empty the way is there on its own, and until
 * the first title is saved (one list, empty) there is nothing at all.
 */
export function ListRows({ lists, items, onPlay, onRemove, onManage }: ListRowsProps) {
  const t = useT();
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
                  playLabel={`${t("rows.play")} ${item.title}`}
                  removeLabel={`${t("rows.removeFromList", { list: name })}: ${item.title}`}
                  onPlay={() => onPlay(item.url, hintOf(item))}
                  onRemove={() => onRemove(item.url, info.id)}
                />
              ))}
          </CardRow>
        );
      })}
    </>
  );
}
