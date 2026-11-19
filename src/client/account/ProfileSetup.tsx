import { useMemo, useState, type ReactNode } from "react";
import { LIBRARY_SECTIONS, preferredLanguages, type LibrarySection, type Profile } from "../../shared";
import { useLanguage, useT } from "../i18n";
import type { Key } from "../i18n";
import { AnimeIcon, CartoonIcon, CheckIcon, FilmIcon, TvIcon } from "../shared/icons";
import { useAccount } from "./AccountProvider";
import { describeError } from "./errors";
import { ProfileEditor } from "./Profiles";
import { useSettings } from "./settings";
import { useProfileData } from "./store";
import { keptLanguages, languageNamer, MAX_SUBTITLE_LANGUAGES, pickableLanguages, toggleLanguage } from "./subtitleLanguages";

const SECTION_LABEL: Record<LibrarySection, Key> = { movie: "tv.movies", series: "tv.series", cartoon: "tv.cartoons", anime: "tv.anime" };
const SECTION_ICON: Record<LibrarySection, ReactNode> = { movie: <FilmIcon />, series: <TvIcon />, cartoon: <CartoonIcon />, anime: <AnimeIcon /> };

export function SectionPicker({ value, onChange, tv = false }: { value: readonly LibrarySection[]; onChange: (next: LibrarySection[]) => void; tv?: boolean }) {
  const t = useT();
  const toggle = (section: LibrarySection) => {
    const next = value.includes(section) ? value.filter((other) => other !== section) : LIBRARY_SECTIONS.filter((other) => other === section || value.includes(other));
    if (next.length > 0) onChange([...next]);
  };
  return (
    <div className={`section-picker${tv ? " section-picker-tv" : ""}`} role="group" aria-label={t("settings.sections")} data-testid="section-picker">
      {LIBRARY_SECTIONS.map((section, index) => {
        const on = value.includes(section);
        const last = on && value.length === 1;
        return (
          <button
            key={section}
            type="button"
            className="section-choice"
            aria-pressed={on}
            {...(last ? { "aria-disabled": true } : {})}
            onClick={() => toggle(section)}
            data-testid={`section-choice-${section}`}
            {...(tv ? { "data-nav": true } : {})}
            {...(tv && index === 0 ? { "data-autofocus": true } : {})}
          >
            <span className="section-choice-icon" aria-hidden="true">
              {SECTION_ICON[section]}
            </span>
            <span className="section-choice-name">{t(SECTION_LABEL[section])}</span>
            <span className="section-choice-tick" aria-hidden="true">
              {on && <CheckIcon />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const sectionsShown = (chosen: readonly LibrarySection[] | undefined): LibrarySection[] => (chosen && chosen.length > 0 ? LIBRARY_SECTIONS.filter((section) => chosen.includes(section)) : [...LIBRARY_SECTIONS]);
export const animeShown = (settings: { child?: boolean | undefined; sections?: readonly LibrarySection[] | undefined }): boolean => settings.child !== true && sectionsShown(settings.sections).includes("anime");
export const sectionsKept =(shown: readonly LibrarySection[]): LibrarySection[] | undefined => (shown.length >= LIBRARY_SECTIONS.length ? undefined : [...shown]);

function LanguagePicker({ chosen, onChange, tv }: { chosen: readonly string[]; onChange: (next: string[]) => void; tv: boolean }) {
  const t = useT();
  const language = useLanguage();
  const name = useMemo(() => languageNamer(language), [language]);
  const full = chosen.length >= MAX_SUBTITLE_LANGUAGES;
  const [listed] = useState(() => pickableLanguages(chosen));
  const said = (index: number) => (index === 0 ? t("setup.main") : index === 1 ? t("setup.second") : t("setup.also"));
  return (
    <>
      <p className="setup-order" data-testid="setup-subtitle-order" aria-live="polite">
        {chosen.length === 0 ? t("setup.noSubtitles") : chosen.map((code, index) => `${said(index)}: ${name(code)}`).join("  ·  ")}
      </p>
      <div className={tv ? "tv-lang-grid" : "language-add setup-languages"} role="group" aria-label={t("settings.subtitleLanguages")}>
        {listed.map((code, index) => {
          const rank = chosen.indexOf(code);
          const blocked = rank < 0 && full;
          return (
            <button
              key={code}
              type="button"
              className={tv ? "tv-lang" : "chip-pill"}
              aria-pressed={rank >= 0}
              {...(blocked ? { "aria-disabled": true } : {})}
              onClick={() => {
                if (!blocked) onChange(toggleLanguage(chosen, code));
              }}
              data-testid={`setup-lang-${code}`}
              {...(tv ? { "data-nav": true } : {})}
              {...(tv && index === 0 ? { "data-autofocus": true } : {})}
            >
              <span className="tv-lang-name">{name(code)}</span>
              {rank >= 0 && <span className="tv-lang-rank">{rank + 1}</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}

type Step = "who" | "subtitles" | "sections";

export interface SetupFrame {
  (step: Step, children: ReactNode): ReactNode;
}

interface SetupProps {
  profile: Profile;
  tv?: boolean;
  frame: SetupFrame;
  onDone?: () => void;
}

export function ProfileSetup(props: SetupProps) {
  const { scope } = useProfileData();
  return scope === props.profile.id ? <SetupPages key={props.profile.id} {...props} /> : null;
}

function SetupPages({ profile, tv = false, frame, onDone }: SetupProps) {
  const t = useT();
  const language = useLanguage();
  const account = useAccount();
  const { settings, set } = useSettings();
  const steps: Step[] = profile.setup === "more" ? ["subtitles", "sections"] : ["who", "subtitles", "sections"];
  const [step, setStep] = useState<Step>(steps[0]!);
  const [subtitles, setSubtitles] = useState<string[]>(() => [...(settings.subtitleLanguages ?? preferredLanguages(undefined, language))]);
  const [sections, setSections] = useState<LibrarySection[]>(() => sectionsShown(settings.sections));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const at = steps.indexOf(step);
  const count = t("setup.step", { n: at + 1, of: steps.length });
  const buttonClass = (main: boolean) => (tv ? `tv-action${main ? " tv-action-primary" : ""}` : `btn${main ? " btn-red" : ""}`);
  const nav = tv ? { "data-nav": true } : {};
  const back = at > 0 ? () => setStep(steps[at - 1]!) : undefined;

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      set("subtitleLanguages", keptLanguages(subtitles));
      set("sections", sectionsKept(sections));
      await account.updateProfile(profile.id, { setup: "done" });
      account.syncNow();
      onDone?.();
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  };

  if (step === "who") {
    return frame(
      step,
      <div className={`setup${tv ? " setup-tv" : ""}`} data-testid="profile-setup" data-step={step}>
        {!tv && <h1>{t("setup.welcome")}</h1>}
        <p className={tv ? "tv-lead setup-lead" : "muted setup-lead"}>
          <span className="setup-count">{count}</span> {t("setup.whoHelp")}
        </p>
        <ProfileEditor
          tv={tv}
          {...(tv ? { heading: t("setup.welcome") } : {})}
          profile={profile}
          taken={(account.me?.profiles ?? []).filter((other) => other.id !== profile.id).map((other) => other.avatar)}
          saveLabel={t("setup.continue")}
          onSave={async (name, avatar) => {
            if (name !== profile.name || avatar !== profile.avatar) await account.updateProfile(profile.id, { name, avatar });
            setStep("subtitles");
          }}
        />
      </div>,
    );
  }

  return frame(
    step,
    <div className={`setup${tv ? " setup-tv" : ""}`} data-testid="profile-setup" data-step={step}>
      <h1 className={tv ? "tv-headline tv-headline-small" : undefined}>{t(step === "subtitles" ? "setup.subtitles" : "setup.sections")}</h1>
      <p className={tv ? "tv-lead setup-lead" : "muted setup-lead"}>
        <span className="setup-count">{count}</span> {t(step === "subtitles" ? "setup.subtitlesHelp" : "setup.sectionsHelp")}
      </p>
      {step === "subtitles" ? <LanguagePicker chosen={subtitles} onChange={setSubtitles} tv={tv} /> : <SectionPicker value={sections} onChange={setSections} tv={tv} />}
      {error && (
        <p className="auth-error" role="alert" data-testid="setup-error">
          {error}
        </p>
      )}
      <div className={tv ? "tv-actions" : "editor-actions"}>
        <button type="button" className={buttonClass(true)} disabled={busy} onClick={() => (step === "subtitles" ? setStep("sections") : void finish())} data-testid="setup-next" {...nav}>
          {t(step === "sections" ? "common.done" : "setup.continue")}
        </button>
        {back && (
          <button type="button" className={buttonClass(false)} disabled={busy} onClick={back} data-testid="setup-back" {...nav}>
            {t("common.back")}
          </button>
        )}
      </div>
    </div>,
  );
}
