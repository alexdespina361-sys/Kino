import { useT } from "../i18n";
import { StarIcon } from "./icons";

/** The score this profile gave a title, in the corner of its picture in a row, a grid or a search: a star and the number. Each screen's stylesheet sizes it. */
export function ScoreBadge({ score }: { score: number }) {
  const t = useT();
  return (
    <span className="score-badge" data-testid="score-badge" title={`${t("rating.yours")}: ${score}/10`} aria-hidden="true">
      <StarIcon filled /> {score}
    </span>
  );
}
