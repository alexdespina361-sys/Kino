import type { ReactNode } from "react";
import { fractionOf, resumeAt, type LiveListItem, type LiveProgress, type PlayHint } from "../../shared";
import { continueNote, hintOf, unfinished } from "../account/cards";
import { useT } from "../i18n";
import { CloseIcon } from "../shared/icons";
import { Poster } from "../shared/Poster";

/** A heading and a row of cards that scrolls sideways, to the screen's edge. */
export function CardRow({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section className="lib-row" data-testid={testId} aria-label={title}>
      <h3>{title}</h3>
      <div className="lib-scroller">{children}</div>
    </section>
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
            image={item.image}
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

/** "My List": the titles this profile saved for later. */
export function ListRow({ items, onPlay, onRemove }: { items: readonly LiveListItem[]; onPlay: (url: string, hint: PlayHint) => void; onRemove: (url: string) => void }) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <CardRow title={t("rows.myList")} testId="list-row">
      {items.map((item) => (
        <Card
          key={item.key}
          testId="list"
          title={item.title}
          image={item.image}
          note={item.year ? String(item.year) : undefined}
          playLabel={`${t("rows.play")} ${item.title}`}
          removeLabel={`${t("rows.removeFromList")}: ${item.title}`}
          onPlay={() => onPlay(item.url, hintOf(item))}
          onRemove={() => onRemove(item.url)}
        />
      ))}
    </CardRow>
  );
}
