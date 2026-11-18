import { getLanguage, useT } from "../i18n";
import { dayOf, linesOf, useNotes } from "./news";
import "./news.css";

export function NewsList({ remote = false, className = "" }: { remote?: boolean; className?: string }) {
  const t = useT();
  const language = getLanguage();
  const notes = useNotes();
  const stop = remote ? { tabIndex: -1, "data-nav": true } : {};
  if (notes.status === "loading") {
    return (
      <p className={`news-wait ${className}`} role="status" data-testid="news-loading">
        {t("common.loading")}
      </p>
    );
  }
  if (notes.status === "failed") {
    return (
      <div className={`news-failed ${className}`} role="alert">
        <p>{t("news.failed")}</p>
        <button className={remote ? "tv-action tv-action-primary" : "btn"} onClick={notes.retry} data-testid="news-retry" {...(remote ? { "data-nav": true } : {})}>
          {t("common.retry")}
        </button>
      </div>
    );
  }
  return (
    <div className={`news-list ${className}`} data-testid="news-list">
      {notes.notes.map((note) => (
        <section key={note.version} className="news-version" aria-labelledby={`news-${note.version}`} data-version={note.version}>
          <h2 id={`news-${note.version}`} className="news-head">
            <b>{t("news.version", { version: note.version })}</b> <span className="news-day">{dayOf(note.date, language)}</span>
          </h2>
          <ul className="news-lines">
            {linesOf(note, language).map((line) => (
              <li key={line} {...stop}>
                {line}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
