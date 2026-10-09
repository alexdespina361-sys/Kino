import { useState, type FormEvent } from "react";
import type { ResolveStatus } from "../../shared";
import { formatTime, hostOf } from "../shared/format";
import { ClipboardIcon, CloseIcon, PlayIcon } from "../shared/icons";
import { firstLink } from "../shared/launch";
import { progressFraction, resumePoint, type HistoryEntry } from "./history";

interface PlayLinkProps {
  tvName: string;
  resolve: ResolveStatus | null;
  history: HistoryEntry[];
  /** Send a page or media link to the TV, optionally from a saved position. */
  onPlay: (url: string, startAt?: number) => void;
  onRemove: (url: string) => void;
}

/** "Paste a link" box with progress, plus the recently played list. Used as the home screen and inside a sheet. */
export function PlayLink({ tvName, resolve, history, onPlay, onRemove }: PlayLinkProps) {
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
            placeholder="Paste a video or page link"
            aria-label="Video or page link"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          {canPaste && !url && (
            <button type="button" className="field-btn" onClick={paste} data-testid="paste">
              <ClipboardIcon /> Paste
            </button>
          )}
          {url && (
            <button type="button" className="field-btn icon" onClick={() => setUrl("")} aria-label="Clear">
              <CloseIcon />
            </button>
          )}
        </div>
        <button type="submit" className="btn btn-red btn-block" data-testid="play-url" disabled={!url.trim()}>
          <PlayIcon /> Play on {tvName}
        </button>
      </form>

      {resolve && (
        <p className={`status ${resolve.phase}`} data-testid="resolve-status" data-phase={resolve.phase} role="status">
          {resolve.phase === "resolving" && (
            <>
              <span className="spinner" />
              Finding video…
            </>
          )}
          {resolve.phase === "found" && `Video found. Sending to ${tvName}…`}
          {resolve.phase === "failed" && resolve.message}
        </p>
      )}

      {history.length > 0 && (
        <section className="recents" aria-label="Recently played">
          <h3>Recently played</h3>
          <ul>
            {history.map((entry) => {
              const resume = resumePoint(entry);
              const fraction = progressFraction(entry);
              return (
                <li key={entry.url} data-testid="recent-item">
                  <button
                    className="recent"
                    onClick={() => onPlay(entry.url, resume)}
                    data-testid="recent-play"
                    aria-label={`${resume === undefined ? "Play" : "Resume"} ${entry.title}`}
                  >
                    <span className="recent-title">{entry.title}</span>
                    <span className="recent-meta">
                      {hostOf(entry.url)}
                      {resume !== undefined && <b> · Resume {formatTime(resume)}</b>}
                    </span>
                    {fraction > 0 && (
                      <span className="recent-bar" aria-hidden="true">
                        <i style={{ width: `${fraction * 100}%` }} />
                      </span>
                    )}
                  </button>
                  {resume !== undefined && (
                    <button
                      className="mini"
                      onClick={() => onPlay(entry.url)}
                      data-testid="recent-restart"
                      aria-label={`Start ${entry.title} from the beginning`}
                    >
                      Start over
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    onClick={() => onRemove(entry.url)}
                    data-testid="recent-remove"
                    aria-label={`Remove ${entry.title} from the list`}
                  >
                    <CloseIcon />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
