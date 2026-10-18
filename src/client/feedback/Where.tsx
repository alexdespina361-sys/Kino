import { FEEDBACK_AREA_GROUPS, type FeedbackArea } from "../../shared";
import { useT, type Key } from "../i18n";
import { Chip } from "./ui";

/** "Where is it?": the places of the app in groups, one of them chosen. A person who cannot say where it is picks "Not sure" and says what it is. */
export function WhereScreen({ value, guessed, onPick }: { value: FeedbackArea; guessed: boolean; onPick: (area: FeedbackArea) => void }) {
  const t = useT();
  return (
    <div className="fb-body" data-testid="fb-where-screen">
      <p className="fb-lead">{t("feedback.whereLead")}</p>
      {guessed ? <p className="fb-note">{t("feedback.whereGuessNote", { place: t(`feedback.area.${value}` as Key) })}</p> : null}
      {FEEDBACK_AREA_GROUPS.map((group) => (
        <section key={group.id} className="fb-section" aria-labelledby={`fb-group-${group.id}`}>
          <h3 id={`fb-group-${group.id}`}>{t(`feedback.group.${group.id}` as Key)}</h3>
          <div className="fb-choice" role="radiogroup" aria-labelledby={`fb-group-${group.id}`}>
            {group.areas.map((area) => (
              <Chip key={area} selected={value === area} testId={`fb-area-${area}`} onClick={() => onPick(area)}>
                {t(`feedback.area.${area}` as Key)}
              </Chip>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
