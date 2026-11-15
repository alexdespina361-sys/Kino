import { useEffect, useState } from "react";
import { UnavailableSchema } from "../../shared";

/** What the server knows nobody could play of one title: the film itself, or episodes of the show ("season:episode"). */
export interface Unavailable {
  title: boolean;
  episodes: ReadonlySet<string>;
}

export const episodeKey = (season: number, episode: number) => `${season}:${episode}`;

const NOTHING: Unavailable = { title: false, episodes: new Set() };
/** An answer is asked again after this long (it changes as titles are played), and not before: a page that is opened again reads it from here. */
const KEEP_MS = 60_000;
const known = new Map<string, { at: number; marks: Unavailable }>();

/**
 * What no source had of the title `link` plays (see `GET /api/library/unavailable`): undefined while it is asked for, and nothing marked for a link the
 * server does not know or a question that failed. It is a label only: Play looks the title up as always.
 */
export function useUnavailable(link: string | undefined): Unavailable | undefined {
  const [answer, setAnswer] = useState<{ link: string; marks: Unavailable }>();
  const kept = link === undefined ? undefined : known.get(link);
  const fresh = kept && Date.now() - kept.at < KEEP_MS ? kept : undefined;

  useEffect(() => {
    if (link === undefined || fresh) return;
    let live = true;
    fetch(`/api/library/unavailable?url=${encodeURIComponent(link)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: unknown) => {
        const parsed = UnavailableSchema.safeParse(body);
        const marks = parsed.success ? { title: parsed.data.title, episodes: new Set(parsed.data.episodes.map((one) => episodeKey(one.season, one.episode))) } : NOTHING;
        if (parsed.success) known.set(link, { at: Date.now(), marks });
        if (live) setAnswer({ link, marks });
      })
      .catch(() => live && setAnswer({ link, marks: NOTHING }));
    return () => {
      live = false;
    };
  }, [link, fresh]);

  if (link === undefined) return NOTHING;
  return fresh?.marks ?? (answer?.link === link ? answer.marks : undefined);
}
