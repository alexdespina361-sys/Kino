import type { TitleAbout } from "../../shared";
import { useLanguage, useT } from "../i18n";
import { ageOf } from "./about";

/** The age rating and the genres of a title, as a line. */
export function AboutFacts({ about, hasRoDub }: { about: TitleAbout; hasRoDub?: boolean }) {
  const t = useT();
  const age = ageOf(about.ages, useLanguage());
  const showDub = Boolean(hasRoDub ?? about.hasRoDub);
  if (!age && about.genres.length === 0 && !showDub) return null;
  return (
    <p className="about-facts" data-testid="about-facts">
      {age && (
        // (The country is the badge's small word: a rating is read as the country that gives it writes it.)
        <span className="about-age" data-testid="about-age" title={t("about.age")}>
          {age.rating}
          <small>{age.country}</small>
        </span>
      )}
      {showDub && (
        <span className="about-dub-badge" data-testid="about-ro-dub" title={t("about.roDubTitle")}>
          Ro Dub
        </span>
      )}
      {about.genres.length > 0 && (
        <span className="about-genres" data-testid="about-genres">
          {about.genres.join(" · ")}
        </span>
      )}
    </p>
  );
}

/** Who directed a film or created a show, and who is in it: a line for each that is known. */
export function AboutPeople({ about }: { about: TitleAbout }) {
  const t = useT();
  const lines = [
    { key: "about.directedBy", names: about.directors },
    { key: "about.createdBy", names: about.creators },
    { key: "about.cast", names: about.cast },
  ] as const;
  const known = lines.filter((line) => line.names.length > 0);
  if (known.length === 0) return null;
  return (
    <dl className="about-people" data-testid="about-people">
      {known.map((line) => (
        <div className="about-person" key={line.key}>
          <dt>{t(line.key)}</dt>
          <dd data-testid={line.key}>{line.names.join(", ")}</dd>
        </div>
      ))}
    </dl>
  );
}
