import { useState, type FormEvent } from "react";
import type { ResolveStatus } from "../../shared";
import { useT } from "../i18n";
import { ClipboardIcon, CloseIcon, PlayIcon } from "../shared/icons";
import { firstLink } from "../shared/launch";
import { resolveFailure } from "../shared/words";

interface PlayLinkProps {
  tvName: string;
  resolve: ResolveStatus | null;
  /** Send a page or media link to the TV. */
  onPlay: (url: string) => void;
}

/** "Paste a link" box and the answer to it. Used as the home screen and inside a sheet. */
export function PlayLink({ tvName, resolve, onPlay }: PlayLinkProps) {
  const t = useT();
  const [url, setUrl] = useState("");
  // Reading the clipboard needs a secure page and a permission; where it isn't there, the button just isn't offered.
  const canPaste = typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (url.trim()) onPlay(url.trim());
  };

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      const link = firstLink(text) ?? text;
      if (link) setUrl(link);
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
        <button type="submit" className="btn btn-red btn-block" data-testid="play-url" disabled={!url.trim()}>
          <PlayIcon /> {t("play.on", { tv: tvName })}
        </button>
      </form>

      {resolve && (
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
      )}
    </div>
  );
}
