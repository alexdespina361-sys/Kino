import { useT } from "../i18n";
import { StarIcon } from "./icons";

export function useScoreWords(): (score: number) => string {
  const t = useT();
  return (score) => `${t("rating.yours")}: ${score}/10`;
}

export function ScoreBadge({ score }: { score: number }) {
  const words = useScoreWords()(score);
  return (
    <span className="score-badge" data-testid="score-badge" title={words} role="img" aria-label={words}>
      <StarIcon filled /> {score}
    </span>
  );
}
