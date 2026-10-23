import { useState, type FormEvent } from "react";
import type { ResolveStatus } from "../../shared";
import { useT } from "../i18n";
import { ClipboardIcon, CloseIcon, PlayIcon } from "../shared/icons";
import { firstLink } from "../shared/launch";
import { resolveFailure } from "../shared/words";

interface PlayLinkProps {
  tvName: string;
  /** Send a page or media link to the TV. */
  onPlay: (url: string) => void;
}

/** "Paste a link" box and its button. (What the lookup of the link is up to is the page's line, `ResolveLine`: a title picked from the library is answered the same way.) */
export function PlayLink({ tvName, onPlay }: PlayLinkProps) {
  const t = useT();
  const [url, setUrl] = useState("");
  // Reading the clipboard needs a secure page and a permission; where it isn't there, the button just isn't offered.
  const canPaste = typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (url.trim()) onPlay(url.trim());
  };

  // A copied link is what the button is for, so it plays at once (one tap, not two); anything else is only put in the box to be looked at.
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      const link = firstLink(text);
      if (link) {
        setUrl(link);
        onPlay(link);
      } else if (text) setUrl(text);
    } catch {
      /* denied or empty: nothing to paste */
    }
  };

  return (
    <div className="play-link">
      <form onSubmit={submit} noValidate>
        <div className="field">
          <input
            data-testid="url-input"
            type="url"
            inputMode="url"
            enterKeyHint="go"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t("play.paste")}
            aria-label={t("play.pasteLabel")}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          {canPaste && !url && (
            <button type="button" className="field-btn" onClick={paste} data-testid="paste">
              <ClipboardIcon /> {t("play.pasteButton")}
            </button>
          )}
          {url && (
            <button type="button" className="field-btn icon" onClick={() => setUrl("")} aria-label={t("common.clear")}>
              <CloseIcon />
            </button>
          )}
        </div>
        {/* The button is there once there is something to play (a button that cannot be pressed is a line of the page that says nothing). */}
        {url.trim() && (
          <button type="submit" className="btn btn-red btn-block" data-testid="play-url">
            <PlayIcon /> {t("play.on", { tv: tvName })}
          </button>
        )}
      </form>
    </div>
  );
}

/** What the lookup of a link is up to, in a line: looking, found (and on its way to the TV), or why it could not be played. Nothing when there is no lookup. */
export function ResolveLine({ resolve, tvName }: { resolve: ResolveStatus | null; tvName: string }) {
  const t = useT();
  if (!resolve || resolve.phase === "cancelled") return null;
  return (
    <p className={`status ${resolve.phase}`} data-testid="resolve-status" data-phase={resolve.phase} role="status">
      {resolve.phase === "resolving" && (
        <>
          <span className="spinner" />
          {t("play.finding")}
        </>
      )}
      {resolve.phase === "found" && t("play.found", { tv: tvName })}
      {resolve.phase === "failed" && resolveFailure(resolve)}
    </p>
  );
}
