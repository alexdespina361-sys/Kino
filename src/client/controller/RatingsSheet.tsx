import { useMemo, useState } from "react";
import type { LibrarySection, LiveRating } from "../../shared";
import { filterRatings, filterRows, ratingChoices, usableFilter, type RatingFilter } from "../account/ratingFilter";
import { factLines, mergeFacts, ratingSummary, scoreWord, sortRatings, storedFacts, watchFacts, type RatingOrder } from "../account/ratings";
import { useProfileData } from "../account/store";
import { useLanguage, useT } from "../i18n";
import { StarIcon } from "../shared/icons";
import { allRows, useFeed } from "../shared/feed";
import { Poster } from "../shared/Poster";
import { entryOfRating, ratingSectionIn, type Entry } from "../tv/pages";
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
  // The filter (the owner: "a simple filter around rating"): one section, one score, or both; a section is told by the rating, else by where the library lists the title.
  const feeding = useFeed();
  const sectionOf = useMemo(() => ratingSectionIn(allRows(feeding.data)), [feeding.data]);
  const [wanted, setWanted] = useState<RatingFilter>({});
  const filter = usableFilter(ratings, wanted, sectionOf);
  const options = ratingChoices(ratings, filter, sectionOf);
  const choices = filterRows(options);
  const sorted = useMemo(() => sortRatings(filterRatings(ratings, filter, sectionOf), order), [ratings, filter.section, filter.score, sectionOf, order]); // eslint-disable-line react-hooks/exhaustive-deps
  const sectionLabel = (section: LibrarySection | undefined) =>
    t(section === undefined ? "tv.filterAll" : section === "movie" ? "tv.filterMovies" : section === "series" ? "tv.filterSeries" : section === "cartoon" ? "tv.filterCartoons" : "tv.filterAnime");

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
        {ratingSummary(t, language, sorted)}
      </p>
      <div className="lib-pills" role="group" aria-label={t("rating.sort")}>
        {(["new", "high"] as const).map((value) => (
          <button key={value} type="button" className="lib-pill" aria-pressed={order === value} onClick={() => setOrder(value)} data-testid={`ratings-sort-${value}`}>
            {t(value === "new" ? "rating.sortNewest" : "rating.sortHighest")}
          </button>
        ))}
      </div>
      {choices.sections.length > 0 && (
        <div className="lib-pills" role="group" aria-label={t("rating.filterKind")}>
          {choices.sections.map((section) => (
            <button key={section ?? "all"} type="button" className="lib-pill" aria-pressed={filter.section === section} onClick={() => setWanted({ ...filter, section })} data-testid={`ratings-filter-${section ?? "all"}`}>
              {sectionLabel(section)} <span className="lib-pill-count">{section ? (options.sections.find((each) => each.section === section)?.count ?? 0) : ratings.length}</span>
            </button>
          ))}
        </div>
      )}
      {choices.scores.length > 0 && (
        <div className="lib-pills" role="group" aria-label={t("rating.filterScores")}>
          {choices.scores.map((score) => (
            <button
              key={score ?? "any"}
              type="button"
              className="lib-pill"
              aria-pressed={filter.score === score}
              {...(score !== undefined ? { "aria-label": t("rating.filterScore", { score }) } : {})}
              onClick={() => setWanted({ ...filter, score })}
              data-testid={`ratings-score-${score ?? "any"}`}
            >
              {score === undefined ? (
                t("rating.filterAnyScore")
              ) : (
                <>
                  <StarIcon filled /> {score}
                </>
              )}
            </button>
          ))}
        </div>
      )}
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
