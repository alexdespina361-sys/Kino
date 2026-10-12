import { useEffect, useRef, useState } from "react";
import { RATING_NOTE_MAX } from "../../shared";
import { factLines, scoreWord, SCORES, useRatingFor } from "../account/ratings";
import { useLanguage, useT } from "../i18n";
import { ChevronIcon, StarIcon, TrashIcon } from "../shared/icons";
import type { Entry } from "../tv/pages";

/** A note that is still being typed is kept this long after the last letter (and when the field loses the focus, and when the page closes). */
const NOTE_SAVE_MS = 700;
/** The counter of how much is left of a note shows once it is this close to the end. */
const NOTE_COUNT_FROM = RATING_NOTE_MAX - 100;

interface BoxProps {
  entry: Entry;
  /** The title is a show: what was watched is counted in episodes. */
  isShow: boolean;
  /** The season this box rates; absent: the title as a whole. */
  season?: number;
  /** How many episodes that season has, when the page knows. */
  total?: number | undefined;
  /** What the box is called ("Your rating", "Season 2 rating"). */
  title: string;
  testId: string;
}

/**
 * A title's (or one of its seasons') rating on the phone, folded to one line: a star, what it is, and the score or "Rate". Opened, it has
 * the ten scores to tap (that alone is a rating), the word for the score, a note box for why, and what the phone knows of the watching
 * behind it: when it was rated, how much was watched, when it was finished or last watched.
 */
export function RatingBox({ entry, isShow, season, total, title, testId }: BoxProps) {
  const t = useT();
  const language = useLanguage();
  const { rating, facts, score, note, remove } = useRatingFor(entry, isShow, season, total);
  const [open, setOpen] = useState(false);
  const lines = factLines(t, language, rating?.ratedAt, facts);

  return (
    <section className="rating-box" data-testid={testId} data-rated={rating !== undefined} data-open={open} aria-label={title}>
      <button className="rating-head" aria-expanded={open} onClick={() => setOpen(!open)} data-testid={`${testId}-toggle`}>
        <StarIcon filled={rating !== undefined} />
        <span className="rating-head-title">{title}</span>
        <span className="rating-head-value" data-testid={`${testId}-value`}>
          {rating ? `${rating.score}/10` : t("rating.rate")}
        </span>
        <ChevronIcon className={open ? "turn-up" : "turn-down"} />
      </button>
      {open && (
        <div className="rating-body">
          <div className="rating-scores" role="radiogroup" aria-label={title}>
            {SCORES.map((value) => (
              <button
                key={value}
                className="rating-score"
                role="radio"
                aria-checked={rating?.score === value}
                aria-label={t("rating.setScore", { score: value })}
                data-testid={`${testId}-score-${value}`}
                onClick={() => score(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <p className="rating-word" role="status" data-testid={`${testId}-word`}>
            {rating ? scoreWord(t, rating.score) : t("rating.pick")}
          </p>
          <NoteField value={rating?.note ?? ""} disabled={rating === undefined} label={t("rating.noteLabel")} placeholder={t(rating ? "rating.notePlaceholder" : "rating.notePick")} onSave={note} testId={`${testId}-note`} />
          {lines.length > 0 && (
            <ul className="rating-facts" data-testid={`${testId}-facts`}>
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {rating && (
            <button className="btn" onClick={remove} data-testid={`${testId}-remove`}>
              <TrashIcon /> {t("rating.remove")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** The box where the person says why. What is typed is kept as it is typed; closing the box or the sheet does not lose it. */
function NoteField({ value, disabled, label, placeholder, onSave, testId }: { value: string; disabled: boolean; label: string; placeholder: string; onSave: (note: string) => void; testId: string }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);
  /** What the profile has kept of it, to tell a change from a field that was only looked at. */
  const kept = useRef(value);
  const timer = useRef<number>(0);
  const latest = useRef({ draft, onSave });
  latest.current = { draft, onSave };

  // The note changed under the field (on another screen, or by a sync): show it, unless it is being typed.
  useEffect(() => {
    kept.current = value;
    if (document.activeElement !== field.current) setDraft(value);
  }, [value]);

  const flush = () => {
    window.clearTimeout(timer.current);
    const text = latest.current.draft.trim();
    if (text === kept.current.trim()) return;
    kept.current = text;
    latest.current.onSave(text);
  };
  useEffect(() => () => flush(), []);

  return (
    <div className="rating-note-field">
      <textarea
        ref={field}
        className="rating-note"
        rows={3}
        maxLength={RATING_NOTE_MAX}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        autoCapitalize="sentences"
        enterKeyHint="done"
        data-testid={testId}
        onChange={(event) => {
          setDraft(event.target.value);
          latest.current.draft = event.target.value;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(flush, NOTE_SAVE_MS);
        }}
        onBlur={flush}
      />
      {draft.length >= NOTE_COUNT_FROM && (
        <small className="rating-count" aria-hidden="true">
          {draft.length}/{RATING_NOTE_MAX}
        </small>
      )}
    </div>
  );
}
