import { useMemo, useState } from "react";
import type { LibrarySection, LiveRating } from "../../shared";
import { filterRatings, filterRows, ratingChoices, usableFilter, type RatingFilter } from "../account/ratingFilter";
import { factLines, mergeFacts, ratingSummary, scoreWord, sortRatings, storedFacts, watchFacts, type RatingOrder } from "../account/ratings";
import { useProfileData } from "../account/store";
import { useLanguage, useT } from "../i18n";
import { useBackWhile } from "../shared/backButton";
import { ChevronIcon, StarIcon } from "../shared/icons";
import { allRows, useFeed } from "../shared/feed";
import { Poster } from "../shared/Poster";
import { useRatingSections } from "../tv/cardSections";
import { entryOfRating, ratingSectionIn, type Entry } from "../tv/pages";
import { Sheet } from "./Sheet";

export function RatingsSheet({ ratings, onOpen, onClose }: { ratings: readonly LiveRating[]; onOpen: (entry: Entry) => void; onClose: () => void }) {
  const t = useT();
  const language = useLanguage();
  const { progress, watched } = useProfileData();
  const [order, setOrder] = useState<RatingOrder>("new");
  const feeding = useFeed();
  const rows = useMemo(() => allRows(feeding.data), [feeding.data]);
  const looked = useRatingSections(ratings, rows, true);
  const sectionOf = useMemo(() => ratingSectionIn(rows, looked), [rows, looked]);
  const [wanted, setWanted] = useState<RatingFilter>({});
  const filter = usableFilter(ratings, wanted, sectionOf);
  const options = ratingChoices(ratings, filter, sectionOf);
  const choices = filterRows(options);
  const sorted = useMemo(() => sortRatings(filterRatings(ratings, filter, sectionOf), order), [ratings, filter.section, filter.score, sectionOf, order]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picking, setPicking] = useState(false);
  useBackWhile(picking, () => setPicking(false));
  const scoreLabel = (score: number | undefined) =>
    score === undefined ? (
      t("rating.filterAnyScore")
    ) : (
      <>
        <StarIcon filled /> {score}
      </>
    );
  const sectionLabel = (section: LibrarySection | undefined) =>
    t(section === undefined ? "tv.filterAll" : section === "movie" ? "tv.filterMovies" : section === "series" ? "tv.filterSeries" : section === "cartoon" ? "tv.filterCartoons" : "tv.filterAnime");

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
            <button
              key={section ?? "all"}
              type="button"
              className="lib-pill"
              aria-pressed={filter.section === section}
              onClick={() => {
                setWanted({ ...filter, section });
                setPicking(false);
              }}
              data-testid={`ratings-filter-${section ?? "all"}`}
            >
              {sectionLabel(section)} <span className="lib-pill-count">{section ? (options.sections.find((each) => each.section === section)?.count ?? 0) : ratings.length}</span>
            </button>
          ))}
        </div>
      )}
      {choices.scores.length > 0 && (
        <div className="lib-pick">
          <button
            type="button"
            className="lib-pill lib-pick-button"
            aria-haspopup="listbox"
            aria-expanded={picking}
            aria-label={`${t("rating.filterScores")}: ${filter.score === undefined ? t("rating.filterAnyScore") : t("rating.filterScore", { score: filter.score })}`}
            onClick={() => setPicking(!picking)}
            data-testid="ratings-pick"
          >
            {scoreLabel(filter.score)}
            <ChevronIcon className="lib-pick-chevron" />
          </button>
          {picking && (
            <div className="lib-pick-grid" role="listbox" aria-label={t("rating.filterScores")}>
              {choices.scores.map((score) => (
                <button
                  key={score ?? "any"}
                  type="button"
                  role="option"
                  className={score === undefined ? "lib-pick-option is-any" : "lib-pick-option"}
                  aria-selected={filter.score === score}
                  {...(score !== undefined ? { "aria-label": t("rating.filterScore", { score }) } : {})}
                  onClick={() => {
                    setWanted({ ...filter, score });
                    setPicking(false);
                  }}
                  data-testid={`ratings-score-${score ?? "any"}`}
                >
                  <span className="lib-pick-name">{scoreLabel(score)}</span>
                  <span className="lib-pill-count">{score === undefined ? options.scores.reduce((sum, each) => sum + each.count, 0) : (options.scores.find((each) => each.score === score)?.count ?? 0)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <ul className="rating-list" data-testid="ratings-list">
        {sorted.map((rating) => {
          const entry = entryOfRating(rating);
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
