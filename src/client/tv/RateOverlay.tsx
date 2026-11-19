import { useState, type MouseEvent } from "react";
import { RATING_NOTE_MAX } from "../../shared";
import { factLines, scoreWord, SCORES, useRatingFor } from "../account/ratings";
import { useLanguage, useT } from "../i18n";
import { TrashIcon } from "../shared/icons";
import { Screen } from "./Idle";
import { appendTo } from "./librarySearch";
import { NameKeys } from "./NameKeys";
import type { Entry } from "./pages";

const START_SCORE = 7;
const NOTE_MARKS = [".", ",", "!", "?", "'", "-"];

interface RateProps {
  entry: Entry;
  isShow: boolean;
  seasons: readonly number[];
  shown: number | undefined;
  episodes: number | undefined;
  onClose: () => void;
}

export function RateOverlay({ entry, isShow, seasons, shown, episodes, onClose }: RateProps) {
  const t = useT();
  const language = useLanguage();
  const [scope, setScope] = useState<number | undefined>(undefined);
  const [noting, setNoting] = useState(false);
  const [more, setMore] = useState(false);
  const { rating, facts, score, note, remove } = useRatingFor(entry, isShow, scope, scope !== undefined && scope === shown ? episodes : undefined);
  const name = scope === undefined ? entry.title : `${entry.title} · ${t("player.season", { n: scope })}`;

  if (noting) {
    return (
      <Screen key="note" testId="tv-rate-note" compact focus onBack={() => setNoting(false)}>
        <h1 className="tv-headline tv-headline-small">{t("rating.noteTitle")}</h1>
        <p className="tv-lead">{name}</p>
        <NoteEditor
          value={rating?.note ?? ""}
          onSave={(text) => {
            note(text);
            setNoting(false);
          }}
          onCancel={() => setNoting(false)}
        />
      </Screen>
    );
  }

  const lines = factLines(t, language, rating?.ratedAt, facts);
  const start = rating?.score ?? START_SCORE;
  const press = (value: number) => {
    if (more) return score(value);
    if (rating?.score !== value) score(value);
    onClose();
  };
  return (
    <Screen key="rate" testId="tv-rate" compact focus onBack={onClose}>
      <h1 className="tv-headline tv-headline-small">{t("rating.yours")}</h1>
      <p className="tv-lead" data-testid="tv-rate-title">
        {name}
      </p>
      {more && isShow && seasons.length > 0 && (
        <div className="tv-choices tv-rate-scopes" role="radiogroup" aria-label={t("player.seasons")}>
          <button className="tv-choice" role="radio" aria-checked={scope === undefined} onClick={() => setScope(undefined)} data-nav data-testid="rate-scope-all">
            {t("rating.wholeShow")}
          </button>
          {seasons.map((number) => (
            <button key={number} className="tv-choice" role="radio" aria-checked={scope === number} onClick={() => setScope(number)} data-nav data-testid={`rate-scope-${number}`}>
              {t("player.season", { n: number })}
            </button>
          ))}
        </div>
      )}
      <div className="tv-scores" role="radiogroup" aria-label={t("rating.yours")}>
        {SCORES.map((value) => (
          <button
            key={value}
            className="tv-score"
            role="radio"
            aria-checked={rating?.score === value}
            aria-label={t("rating.setScore", { score: value })}
            onClick={() => press(value)}
            data-nav
            {...(value === start ? { "data-autofocus": true } : {})}
            data-testid={`rate-score-${value}`}
          >
            {value}
          </button>
        ))}
      </div>
      <p className="tv-rate-word" role="status" data-testid="rate-word">
        {rating ? scoreWord(t, rating.score) : t("rating.pick")}
      </p>
      {more && rating?.note && (
        <p className="tv-rate-note" data-testid="rate-note-text">
          {rating.note}
        </p>
      )}
      {more && lines.length > 0 && (
        <ul className="tv-rate-facts" data-testid="rate-facts">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className="tv-actions tv-rate-actions">
        {more && (
          <button className="tv-action" disabled={!rating} onClick={() => setNoting(true)} data-nav data-testid="rate-note-button">
            {t(rating?.note ? "rating.editNote" : "rating.addNote")}
          </button>
        )}
        <button
          className="tv-action"
          aria-expanded={more}
          onClick={() => {
            if (more) setScope(undefined);
            setMore(!more);
          }}
          data-nav
          data-testid="rate-more"
        >
          {t(more ? "rating.less" : "rating.more")}
        </button>
        {rating && (
          <button
            className="tv-action tv-action-danger"
            onClick={(event: MouseEvent<HTMLElement>) => {
              remove();
              event.currentTarget.closest("[data-testid='tv-rate']")?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
            }}
            data-nav
            data-testid="rate-remove"
          >
            <TrashIcon /> {t("rating.remove")}
          </button>
        )}
        <button className="tv-action tv-action-primary" onClick={onClose} data-nav data-testid="rate-done">
          {t("common.done")}
        </button>
      </div>
    </Screen>
  );
}

function NoteEditor({ value, onSave, onCancel }: { value: string; onSave: (note: string) => void; onCancel: () => void }) {
  const t = useT();
  const [text, setText] = useState(value);
  const change = (update: (before: string) => string) => setText((before) => update(before).slice(0, RATING_NOTE_MAX));
  return (
    <form
      className="profile-editor profile-editor-tv list-editor-tv rating-editor-tv"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(text);
      }}
      noValidate
      data-testid="rate-note-editor"
    >
      <label className="auth-field">
        <span>{t("rating.noteLabel")}</span>
        <input
          data-testid="rate-note-input"
          value={text}
          maxLength={RATING_NOTE_MAX}
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="done"
          placeholder={t("rating.notePlaceholder")}
          onChange={(event) => setText(event.target.value)}
          data-nav
        />
      </label>
      <NameKeys
        more={NOTE_MARKS}
        onKey={(char) => change((before) => appendTo(before, before === "" ? char.toUpperCase() : char, RATING_NOTE_MAX))}
        onDelete={() => change((before) => before.slice(0, -1))}
        onClear={() => change(() => "")}
      />
      <div className="editor-actions">
        <button type="button" className="tv-action" onClick={onCancel} data-nav data-testid="rate-note-cancel">
          {t("common.cancel")}
        </button>
        <button type="submit" className="tv-action tv-action-primary" data-nav data-testid="rate-note-save">
          {t("common.save")}
        </button>
      </div>
    </form>
  );
}
