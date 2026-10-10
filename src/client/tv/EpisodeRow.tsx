import { useState } from "react";
import { CheckIcon, PlayIcon } from "../shared/icons";
import { hueOf } from "../shared/Poster";

export interface EpisodeCard {
  number: number;
  name: string;
  /** A picture from the episode. Without one (or when it does not load) the tile is a colour made from the name. */
  still?: string | undefined;
  overview?: string | undefined;
  /** At the end of the name's line: that it is playing, how much is left of it, or how long it runs. */
  meta?: string | undefined;
  state: "now" | "new" | "started" | "watched";
  /** How far in you are (0 to 1), drawn along the foot of the picture. */
  fraction?: number | undefined;
}

/** What is inside one button of the episode list, the way a streaming app lists them: number, a still, the name and length, a line about it. */
export function EpisodeRow({ number, name, still, overview, meta, state, fraction }: EpisodeCard) {
  const [broken, setBroken] = useState(false);
  const hue = hueOf(name);
  return (
    <>
      <span className="tv-ep-no">{number}</span>
      <span className="tv-ep-still" style={{ background: `linear-gradient(135deg, hsl(${hue} 40% 26%), hsl(${(hue + 40) % 360} 45% 12%))` }}>
        {still && !broken && <img src={still} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
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
        {overview && <span className="tv-ep-about">{overview}</span>}
      </span>
    </>
  );
}
