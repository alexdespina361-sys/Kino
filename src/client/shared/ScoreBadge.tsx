import { useT } from "../i18n";
import { StarIcon } from "./icons";

/** What the score is called to someone who cannot see the star ("Your rating: 8/10"): its tooltip, and what is said of the picture it is on. */
export function useScoreWords(): (score: number) => string {
  const t = useT();
  return (score) => `${t("rating.yours")}: ${score}/10`;
}

/**
 * The score this profile gave a title, in the corner of its picture in a row, a grid or a search: a star and the number. Each screen's
 * stylesheet sizes it. It is a picture with words of its own, so a screen reader says it once, with the title it is on.
 */
export function ScoreBadge({ score }: { score: number }) {
  const words = useScoreWords()(score);
  return (
    <span className="score-badge" data-testid="score-badge" title={words} role="img" aria-label={words}>
      <StarIcon filled /> {score}
    </span>
  );
}
