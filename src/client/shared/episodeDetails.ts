import { useEffect, useState } from "react";
import { EpisodeDetailsSchema, type EpisodeDetail } from "../../shared";

/** What a season's episodes are known by, by episode number. */
export type SeasonDetails = ReadonlyMap<number, EpisodeDetail>;

/** What was learned of a season, kept for as long as the page is open: `null` is "asked, and nobody knows". */
const learned = new Map<string, SeasonDetails | null>();

const keyOf = (link: string, season: number) => `${season}|${link}`;

/**
 * What the server's library knows about each episode of one season of a show (a still, a line about it, how long it
 * runs), asked for with the link of any episode in that season. `undefined` while it is being asked, `null` when
 * nothing is known (the list then stays plain), otherwise the details by episode number. Only a failed request is asked again.
 */
export function useEpisodeDetails(link: string | undefined, season: number | undefined): SeasonDetails | null | undefined {
  const key = link !== undefined && season !== undefined ? keyOf(link, season) : undefined;
  const [answer, setAnswer] = useState<{ key: string; details: SeasonDetails | null }>();

  useEffect(() => {
    if (key === undefined || link === undefined || season === undefined || learned.has(key)) return;
    let live = true;
    fetch(`/api/library/episodes?season=${season}&url=${encodeURIComponent(link)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: unknown) => {
        const parsed = EpisodeDetailsSchema.safeParse(body);
        const details = parsed.success && parsed.data.episodes.length > 0 ? new Map(parsed.data.episodes.map((detail) => [detail.episode, detail])) : null;
        learned.set(key, details);
        if (live) setAnswer({ key, details });
      })
      .catch(() => live && setAnswer({ key, details: null }));
    return () => {
      live = false;
    };
  }, [key, link, season]);

  if (key === undefined) return null;
  if (learned.has(key)) return learned.get(key) ?? null;
  return answer?.key === key ? answer.details : undefined;
}
