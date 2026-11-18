import { useEffect, useRef, useState } from "react";
import { RATING_NOTE_MAX } from "../../shared";
import { factLines, scoreWord, SCORES, useRatingFor } from "../account/ratings";
import { useLanguage, useT } from "../i18n";
import { ChevronIcon, StarIcon, TrashIcon } from "../shared/icons";
import type { Entry } from "../tv/pages";

const NOTE_SAVE_MS = 700;
const NOTE_COUNT_FROM = RATING_NOTE_MAX - 100;

interface BoxProps {
  entry: Entry;
  isShow: boolean;
  season?: number;
  total?: number | undefined;
  title: string;
  testId: string;
  quick?: boolean;
}

export function RatingBox({ entry, isShow, season, total, title, testId, quick = false }: BoxProps) {
  const t = useT();
  const language = useLanguage();
  const { rating, facts, score, note, remove } = useRatingFor(entry, isShow, season, total);
  const [open, setOpen] = useState(false);
  const lines = factLines(t, language, rating?.ratedAt, facts);

  const scores = (
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
  );
  const word = (
    <p className="rating-word" role="status" data-testid={`${testId}-word`}>
      {rating ? scoreWord(t, rating.score) : t("rating.pick")}
    </p>
  );
  const noteAndFacts = (
    <>
      <NoteField value={rating?.note ?? ""} disabled={rating === undefined} label={t("rating.noteLabel")} placeholder={t(rating ? "rating.notePlaceholder" : "rating.notePick")} onSave={note} testId={`${testId}-note`} />
      {lines.length > 0 && (
        <ul className="rating-facts" data-testid={`${testId}-facts`}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </>
  );
  const removeButton = rating && (
    <button className="btn" onClick={remove} data-testid={`${testId}-remove`}>
      <TrashIcon /> {t("rating.remove")}
    </button>
  );

  if (quick) {
    return (
      <section className="rating-box rating-box-quick" data-testid={testId} data-rated={rating !== undefined} data-open={open} aria-label={title}>
        <div className="rating-head rating-head-static">
          <StarIcon filled={rating !== undefined} />
          <span className="rating-head-title">{title}</span>
          <span className="rating-head-value" data-testid={`${testId}-value`}>
            {rating ? `${rating.score}/10` : ""}
          </span>
        </div>
        <div className="rating-body">
          {scores}
          {word}
          <div className="rating-actions">
            <button className="btn rating-more" aria-expanded={open} onClick={() => setOpen(!open)} data-testid={`${testId}-toggle`}>
              {t(open ? "rating.less" : "rating.more")} <ChevronIcon className={open ? "turn-up" : "turn-down"} />
            </button>
            {removeButton}
          </div>
          {open && noteAndFacts}
        </div>
      </section>
    );
  }

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
          {scores}
          {word}
          {noteAndFacts}
          {removeButton}
        </div>
      )}
    </section>
  );
}

function NoteField({ value, disabled, label, placeholder, onSave, testId }: { value: string; disabled: boolean; label: string; placeholder: string; onSave: (note: string) => void; testId: string }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);
  const kept = useRef(value);
  const timer = useRef<number>(0);
  const latest = useRef({ draft, onSave });
  latest.current = { draft, onSave };

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
