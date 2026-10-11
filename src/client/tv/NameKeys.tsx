import { useLanguage, useT } from "../i18n";
import { BackspaceIcon } from "../shared/icons";
import { KEYBOARD_KEYS } from "./librarySearch";

/** What a language writes beyond a to z, on keys of their own: a list may be named in the language of the person. */
const EXTRA_LETTERS: Partial<Record<string, readonly string[]>> = { ro: [..."ăâîșț"], it: [..."àèéìòù"] };

interface Props {
  onKey: (char: string) => void;
  onDelete: () => void;
  onClear: () => void;
}

/** The keys for typing the name of a list with the remote: the letters and digits of the search, twelve to a row, then Space, Delete and Clear. */
export function NameKeys({ onKey, onDelete, onClear }: Props) {
  const t = useT();
  const language = useLanguage();
  return (
    <div className="tv-keys tv-name-keys" role="group" aria-label={t("tv.keyboard")}>
      {[...KEYBOARD_KEYS, ...(EXTRA_LETTERS[language] ?? [])].map((key) => (
        <button key={key} type="button" className="tv-key" data-testid={`name-key-${key}`} onClick={() => onKey(key)} data-nav>
          {key}
        </button>
      ))}
      <button type="button" className="tv-key tv-key-wide tv-key-first" data-testid="name-key-space" onClick={() => onKey(" ")} data-nav>
        {t("tv.space")}
      </button>
      <button type="button" className="tv-key tv-key-wide" data-testid="name-key-delete" onClick={onDelete} data-nav>
        <BackspaceIcon /> {t("tv.delete")}
      </button>
      <button type="button" className="tv-key tv-key-wide" data-testid="name-key-clear" onClick={onClear} data-nav>
        {t("tv.clear")}
      </button>
    </div>
  );
}
