import { useEffect, useRef, useState } from "react";
import { getLanguage, useT } from "../i18n";
import { dayOf, linesOf, useNotes } from "./news";
import "./news.css";

const NEWS_STEP = 6;

export function NewsList({ remote = false, className = "" }: { remote?: boolean; className?: string }) {
  const t = useT();
  const language = getLanguage();
  const notes = useNotes();
  const [shown, setShown] = useState(NEWS_STEP);
  const box = useRef<HTMLDivElement>(null);
  const grown = useRef(false);
  useEffect(() => {
    if (!grown.current) return;
    grown.current = false;
    if (remote) box.current?.querySelectorAll<HTMLElement>(".news-version")[shown - NEWS_STEP]?.querySelector<HTMLElement>("li")?.focus();
  }, [shown, remote]);
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
  const older = notes.notes.length - shown;
  return (
    <div ref={box} className={`news-list ${className}`} data-testid="news-list">
      {notes.notes.slice(0, shown).map((note) => (
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
      {older > 0 && (
        <button
          type="button"
          className={remote ? "tv-action news-more" : "btn btn-block news-more"}
          onClick={() => {
            grown.current = true;
            setShown((count) => count + NEWS_STEP);
          }}
          data-testid="news-more"
          {...(remote ? { "data-nav": true } : {})}
        >
          {t("news.more")}
        </button>
      )}
    </div>
  );
}
