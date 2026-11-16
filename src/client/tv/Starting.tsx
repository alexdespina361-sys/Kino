import { useEffect, useRef, useState } from "react";
import type { PlayHint } from "../../shared";
import { useT } from "../i18n";
import { formatTime } from "../shared/format";
import { useBack, useDpad } from "./dpad";

/**
 * A film on its way, from the press of Play to its first moving picture. The TV goes to the film at once and waits there: the title and its picture,
 * where it picks up, and a line that moves on as the wait does. One screen from the press to the picture, where there used to be a black page that
 * said it was looking, and then a black picture with a wheel on it.
 */
export interface Starting {
  /** `performance.now()` when the press, or the start of the look-up, was seen; null for a film handed straight to the TV (a phone's own link, a film put back). */
  since: number | null;
  /** `performance.now()` when the film was handed over (LOAD): from then on it is the picture that is waited for. */
  loadedAt: number | null;
  /** The server said it is looking (TV_RESOLVING). A press the server has not answered yet ends by itself (see `UNHEARD_MS`). */
  heard: boolean;
  title?: string | undefined;
  /** The picture shown while waiting: the one the title's card had, kept once it is there (the source's own does not replace it, which would be a jump). */
  art?: string | undefined;
  /** Where the film picks up, in seconds. */
  from?: number | undefined;
  /** The picture is there: the layer fades away (see `STARTING_FADE_MS`). */
  leaving?: boolean;
}

/** A press of Play the server says nothing about for this long (it refused it, or never got it) is not waited for any more. */
export const UNHEARD_MS = 4000;
/** How long the layer takes to fade away once the picture moves (as long as the stylesheet's fade). */
export const STARTING_FADE_MS = 450;

/** A start from what the one who asked knew about the title. */
export function startingFrom(hint: PlayHint | undefined, extra: Partial<Starting> = {}): Starting {
  return { since: performance.now(), loadedAt: null, heard: false, title: hint?.title, art: hint?.backdrop ?? hint?.poster, ...extra };
}

interface Props {
  starting: Starting;
  /** It has gone on too long: the line says so and there is a way out. */
  stuck: boolean;
  onCancel: () => void;
}

/** What the screen shows while a film starts. Under the player's controls and its lines; it takes no press but its Cancel (the picture's taps go through it). */
export function StartingFilm({ starting, stuck, onCancel }: Props) {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const finding = starting.loadedAt === null;
  // While the video is looked for there is no player under this to take the keys: Back (and OK on Cancel) are this layer's, as they were the waiting page's.
  // Once the video is loading, the player's own keys do it (see Tv.tsx: OK or Back gives up on a film that will not start).
  useDpad(ref, finding);
  useBack(finding && !starting.leaving ? onCancel : undefined);
  useEffect(() => {
    if (stuck && finding) ref.current?.querySelector<HTMLElement>("[data-testid='tv-cancel-load']")?.focus();
  }, [stuck, finding]);
  // A picture that does not come is not waited for: the layer is the same without it.
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
      // (Drawn from the press of Play at once; heard once the server has said it is looking. Only from then is a wait counted.)
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
