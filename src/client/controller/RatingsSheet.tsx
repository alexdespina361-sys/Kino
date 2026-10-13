import { useMemo, useState } from "react";
import type { LiveRating } from "../../shared";
import { factLines, mergeFacts, ratingSummary, scoreWord, sortRatings, storedFacts, watchFacts, type RatingOrder } from "../account/ratings";
import { useProfileData } from "../account/store";
import { useLanguage, useT } from "../i18n";
import { StarIcon } from "../shared/icons";
import { Poster } from "../shared/Poster";
import { entryOfRating, type Entry } from "../tv/pages";
import { Sheet } from "./Sheet";

/**
 * Everything this profile rated, on one page: the title (and which season), the score with its word, the note, and the few lines about
 * the watching (rated when, how much, finished when). Newest first, or the best first. A tap opens the title, where all of it can be changed.
 */
export function RatingsSheet({ ratings, onOpen, onClose }: { ratings: readonly LiveRating[]; onOpen: (entry: Entry) => void; onClose: () => void }) {
  const t = useT();
  const language = useLanguage();
  const { progress, watched } = useProfileData();
  const [order, setOrder] = useState<RatingOrder>("new");
  const sorted = useMemo(() => sortRatings(ratings, order), [ratings, order]);

  // (The first time here, or after the last one was taken back: what to do, not sorting buttons for nothing.)
  if (ratings.length === 0) {
    return (
      <Sheet title={t("rating.mine")} onClose={onClose} testId="ratings-sheet">
        <p className="muted" data-testid="ratings-empty">
          {t("rating.empty")}
        </p>
      </Sheet>
    );
  }

  return (
    <Sheet title={t("rating.mine")} onClose={onClose} testId="ratings-sheet">
      <p className="muted small" data-testid="ratings-summary">
        {ratingSummary(t, language, ratings)}
      </p>
      <div className="lib-pills" role="group" aria-label={t("rating.sort")}>
        {(["new", "high"] as const).map((value) => (
          <button key={value} type="button" className="lib-pill" aria-pressed={order === value} onClick={() => setOrder(value)} data-testid={`ratings-sort-${value}`}>
            {t(value === "new" ? "rating.sortNewest" : "rating.sortHighest")}
          </button>
        ))}
      </div>
      <ul className="rating-list" data-testid="ratings-list">
        {sorted.map((rating) => {
          const entry = entryOfRating(rating);
          // (What was watched since it was rated counts too, the way the title's own page says it.)
          const facts = mergeFacts(storedFacts(rating), watchFacts(entry, rating.kind === "series" || rating.season !== undefined, rating.season, rating.of, progress, watched));
          return (
            <li key={rating.key}>
              <button className="rating-item" data-testid="rating-entry" data-score={rating.score} data-season={rating.season} onClick={() => onOpen(entry)}>
                <Poster className="lib-result-art" title={rating.title} image={rating.backdrop ?? rating.image} />
                <span className="rating-text">
                  <span className="rating-name">{rating.season ? `${rating.title} · ${t("player.season", { n: rating.season })}` : rating.title}</span>
                  <span className="rating-line">
                    <span className="rating-badge">
                      <StarIcon filled /> {rating.score}/10
                    </span>
                    <span className="muted">{scoreWord(t, rating.score)}</span>
                  </span>
                  {rating.note && <span className="rating-quote">{rating.note}</span>}
                  <span className="rating-facts">
                    {factLines(t, language, rating.ratedAt, facts).map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
