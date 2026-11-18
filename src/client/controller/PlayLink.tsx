import { useState, type FormEvent } from "react";
import type { ResolveStatus } from "../../shared";
import { useT } from "../i18n";
import { ClipboardIcon, CloseIcon, PlayIcon } from "../shared/icons";
import { firstLink, linkOf } from "../shared/launch";
import { resolveFailure } from "../shared/words";

interface PlayLinkProps {
  tvName: string;
  onPlay: (url: string) => void;
}

export function PlayLink({ tvName, onPlay }: PlayLinkProps) {
  const t = useT();
  const [url, setUrl] = useState("");
  const canPaste = typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const link = linkOf(url);
    if (link) onPlay(link);
  };

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      const link = firstLink(text);
      if (link) {
        setUrl(link);
        onPlay(link);
      } else if (text) setUrl(text);
    } catch {
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
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text");
              const link = linkOf(pasted);
              if (link === pasted.trim()) return;
              event.preventDefault();
              setUrl(link);
            }}
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
        {url.trim() && (
          <button type="submit" className="btn btn-red btn-block" data-testid="play-url">
            <PlayIcon /> {t("play.on", { tv: tvName })}
          </button>
        )}
      </form>
    </div>
  );
}

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
