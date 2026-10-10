import { UI_LANGUAGES } from "../../shared";
import { LANGUAGE_NAMES, t, useLanguage } from "../i18n";
import { chooseLanguage } from "./settings";

/** The three languages side by side, for the first screens a visitor sees (the rest of the choices are in Settings). */
export function LanguageSwitch() {
  const language = useLanguage();
  return (
    <div className="segmented compact" role="radiogroup" aria-label={t("settings.language")} data-testid="language-switch">
      {UI_LANGUAGES.map((code) => (
        <button key={code} type="button" role="radio" lang={code} aria-checked={language === code} onClick={() => chooseLanguage(code)} data-testid={`switch-lang-${code}`}>
          {LANGUAGE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}
