import { LIBRARY_SECTIONS, type LibrarySection, type LiveRating } from "../../shared";

/**
 * The filter of the ratings (the page on a TV or a computer, the sheet on a phone): only the titles of one section, only those given one score, or both.
 * (The owner, 15 Nov 2026: "a simple filter around rating (filters for stuff rated a specific number plus series/anime/movie/cartoon filter)".) Pure, so
 * that the TV and the phone choose alike and it can be tested without a screen.
 */
export interface RatingFilter {
  section?: LibrarySection | undefined;
  score?: number | undefined;
}

/** Where a rated title is browsed: Movies, Series, Cartoons or Anime. */
export type SectionOfRating = (rating: LiveRating) => LibrarySection;

/** What a rating says of itself: a cartoon or an anime when it was rated where the library said so, else its kind; one that says neither is taken for a film. */
export const ownSection: SectionOfRating = (rating) => rating.section ?? rating.kind ?? "movie";

export interface RatingChoices {
  /** The sections the ratings are in, in the order of the library's pages, with how many there are of each. */
  sections: Array<{ section: LibrarySection; count: number }>;
  /** The scores given, among the ratings of the section that is chosen (all of them when none is), the highest first, with how many of each. */
  scores: Array<{ score: number; count: number }>;
}

/** What there is to choose from: only sections and scores some rating has, so that no choice shows an empty page. */
export function ratingChoices(ratings: readonly LiveRating[], filter: RatingFilter, sectionOf: SectionOfRating = ownSection): RatingChoices {
  const perSection = new Map<LibrarySection, number>();
  for (const rating of ratings) {
    const section = sectionOf(rating);
    perSection.set(section, (perSection.get(section) ?? 0) + 1);
  }
  const sections = LIBRARY_SECTIONS.flatMap((section) => {
    const count = perSection.get(section);
    return count ? [{ section, count }] : [];
  });
  const section = sections.some((each) => each.section === filter.section) ? filter.section : undefined;
  const perScore = new Map<number, number>();
  for (const rating of ratings) if (!section || sectionOf(rating) === section) perScore.set(rating.score, (perScore.get(rating.score) ?? 0) + 1);
  const scores = [...perScore].sort(([a], [b]) => b - a).map(([score, count]) => ({ score, count }));
  return { sections, scores };
}

/**
 * The filter as it can be kept: a section or a score that none of the ratings has any more (the last of them was taken back, or the section's last title
 * was given another score) is let go, and the page shows the rest rather than nothing.
 */
export function usableFilter(ratings: readonly LiveRating[], filter: RatingFilter, sectionOf: SectionOfRating = ownSection): RatingFilter {
  const choices = ratingChoices(ratings, filter, sectionOf);
  const section = choices.sections.some((each) => each.section === filter.section) ? filter.section : undefined;
  const score = choices.scores.some((each) => each.score === filter.score) ? filter.score : undefined;
  return { ...(section ? { section } : {}), ...(score !== undefined ? { score } : {}) };
}

/** The ratings the filter keeps, in the order they came. */
export function filterRatings(ratings: readonly LiveRating[], filter: RatingFilter, sectionOf: SectionOfRating = ownSection): LiveRating[] {
  const { section, score } = usableFilter(ratings, filter, sectionOf);
  return ratings.filter((rating) => (!section || sectionOf(rating) === section) && (score === undefined || rating.score === score));
}

/**
 * The rows of choices a screen shows: the sections (All first) when the ratings are in more than one, the scores (Any first) when more than one was
 * given. A row with a single choice would choose nothing, so it is left out; `undefined` is the choice of all.
 */
export function filterRows(choices: RatingChoices): { sections: Array<LibrarySection | undefined>; scores: Array<number | undefined> } {
  return {
    sections: choices.sections.length > 1 ? [undefined, ...choices.sections.map((each) => each.section)] : [],
    scores: choices.scores.length > 1 ? [undefined, ...choices.scores.map((each) => each.score)] : [],
  };
}
