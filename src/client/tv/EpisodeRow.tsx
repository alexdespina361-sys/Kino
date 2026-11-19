import { useState, type CSSProperties } from "react";
import { t } from "../i18n";
import { CheckIcon, PlayIcon } from "../shared/icons";
import { comesIn, hueOf } from "../shared/Poster";

export interface EpisodeCard {
  number: number;
  name: string;
  still?: string | undefined;
  overview?: string | undefined;
  meta?: string | undefined;
  state: "now" | "new" | "started" | "watched";
  fraction?: number | undefined;
  unavailable?: boolean | undefined;
}

export const digitsStyle = (episodes: readonly { episode: number }[]): CSSProperties =>
  ({ "--ep-digits": episodes.reduce((most, one) => Math.max(most, String(one.episode).length), 1) }) as CSSProperties;

export function EpisodeRow({ number, name, still, overview, meta, state, fraction, unavailable }: EpisodeCard) {
  const [broken, setBroken] = useState(false);
  const hue = hueOf(name);
  return (
    <>
      <span className="tv-ep-no">{number}</span>
      <span className="tv-ep-still" style={{ background: `linear-gradient(135deg, hsl(${hue} 40% 26%), hsl(${(hue + 40) % 360} 45% 12%))` }}>
        {still && !broken && <img src={still} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} {...comesIn} />}
        <span className="tv-ep-play" aria-hidden="true">
          <PlayIcon />
        </span>
        {fraction !== undefined && (
          <span className="tv-ep-bar" aria-hidden="true">
            <i style={{ width: `${Math.round(fraction * 100)}%` }} />
          </span>
        )}
      </span>
      <span className="tv-ep-text">
        <span className="tv-ep-head">
          <span className="tv-ep-name">{name}</span>
          {meta && (
            <span className="tv-ep-meta" data-state={state}>
              {state === "watched" && <CheckIcon />}
              {meta}
            </span>
          )}
        </span>
        {unavailable && (
          <span className="tv-ep-gone" data-testid="episode-unavailable">
            {t("library.unavailable")}
          </span>
        )}
        {overview && <span className="tv-ep-about">{overview}</span>}
      </span>
    </>
  );
}
