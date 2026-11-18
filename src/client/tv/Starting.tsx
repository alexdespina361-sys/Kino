import { useEffect, useRef, useState } from "react";
import type { PlayHint } from "../../shared";
import { useT } from "../i18n";
import { formatTime } from "../shared/format";
import { useBack, useDpad } from "./dpad";

export interface Starting {
  since: number | null;
  loadedAt: number | null;
  heard: boolean;
  title?: string | undefined;
  art?: string | undefined;
  from?: number | undefined;
  leaving?: boolean;
}

export const UNHEARD_MS = 4000;
export const STARTING_FADE_MS = 450;

export function startingFrom(hint: PlayHint | undefined, extra: Partial<Starting> = {}): Starting {
  return { since: performance.now(), loadedAt: null, heard: false, title: hint?.title, art: hint?.backdrop ?? hint?.poster, ...extra };
}

interface Props {
  starting: Starting;
  stuck: boolean;
  onCancel: () => void;
}

export function StartingFilm({ starting, stuck, onCancel }: Props) {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const finding = starting.loadedAt === null;
  useDpad(ref, finding);
  useBack(finding && !starting.leaving ? onCancel : undefined);
  useEffect(() => {
    if (stuck && finding) ref.current?.querySelector<HTMLElement>("[data-testid='tv-cancel-load']")?.focus();
  }, [stuck, finding]);
  const [broken, setBroken] = useState<string | null>(null);
  const art = starting.art && starting.art !== broken ? starting.art : null;
  const line = stuck ? t("tv.slow") : finding ? t("starting.finding") : t("starting.loading");

  return (
    <section
      ref={ref}
      className="tv-starting"
      data-phase={starting.leaving ? "done" : finding ? "finding" : "loading"}
      data-art={art ? true : undefined}
      data-testid={finding ? "tv-resolving" : "tv-starting"}
      data-heard={starting.heard ? "true" : undefined}
      aria-busy={!starting.leaving}
    >
      {art && <img className="tv-starting-art" src={art} alt="" decoding="async" onError={() => setBroken(art)} />}
      <header className="hud-top">
        <div className="hud-titles">
          {starting.title && (
            <h1 className="hud-title" data-testid="tv-starting-title">
              {starting.title}
            </h1>
          )}
          {starting.from !== undefined && starting.from > 5 && <p className="tv-starting-from">{t("starting.from", { time: formatTime(starting.from) })}</p>}
        </div>
      </header>
      <footer className="hud-bottom tv-starting-foot">
        <p className="tv-starting-line" role="status">
          {line}
        </p>
        <div className="tv-starting-track" {...(finding ? {} : { "data-testid": "tv-buffering" })}>
          <div className="tv-starting-fill" />
        </div>
        {stuck && (
          <div className="tv-actions">
            <button className="tv-action tv-action-primary" onClick={onCancel} data-testid="tv-cancel-load" data-nav>
              {t("common.cancel")}
            </button>
          </div>
        )}
      </footer>
    </section>
  );
}
