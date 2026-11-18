import { LIBRARY_SECTIONS, type LibrarySection, type LiveRating } from "../../shared";

export interface RatingFilter {
  section?: LibrarySection | undefined;
  score?: number | undefined;
}

export type SectionOfRating = (rating: LiveRating) => LibrarySection;

export const ownSection: SectionOfRating = (rating) => rating.section ?? rating.kind ?? "movie";

export interface RatingChoices {
  sections: Array<{ section: LibrarySection; count: number }>;
  scores: Array<{ score: number; count: number }>;
}

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

export function usableFilter(ratings: readonly LiveRating[], filter: RatingFilter, sectionOf: SectionOfRating = ownSection): RatingFilter {
  const choices = ratingChoices(ratings, filter, sectionOf);
  const section = choices.sections.some((each) => each.section === filter.section) ? filter.section : undefined;
  const score = choices.scores.some((each) => each.score === filter.score) ? filter.score : undefined;
  return { ...(section ? { section } : {}), ...(score !== undefined ? { score } : {}) };
}

export function filterRatings(ratings: readonly LiveRating[], filter: RatingFilter, sectionOf: SectionOfRating = ownSection): LiveRating[] {
  const { section, score } = usableFilter(ratings, filter, sectionOf);
  return ratings.filter((rating) => (!section || sectionOf(rating) === section) && (score === undefined || rating.score === score));
}

export function filterRows(choices: RatingChoices): { sections: Array<LibrarySection | undefined>; scores: Array<number | undefined> } {
  return {
    sections: choices.sections.length > 1 ? [undefined, ...choices.sections.map((each) => each.section)] : [],
    scores: choices.scores.length > 1 ? [undefined, ...choices.scores.map((each) => each.score)] : [],
  };
}
