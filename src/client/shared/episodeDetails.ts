import { useEffect, useState } from "react";
import { EpisodeDetailsSchema, SeasonsSchema, type EpisodeDetail } from "../../shared";

export type SeasonDetails = ReadonlyMap<number, EpisodeDetail>;

const seasonsFound = new Map<string, number[]>();

const showOf = (link: string): string => {
  try {
    const url = new URL(link, "http://kino.local");
    return `${url.origin}${url.pathname}`;
  } catch {
    return link;
  }
};

export function useSeasons(link: string | undefined): number[] | undefined {
  const key = link === undefined ? undefined : showOf(link);
  const [answer, setAnswer] = useState<{ key: string; seasons: number[] }>();

  useEffect(() => {
    if (key === undefined || link === undefined || seasonsFound.has(key)) return;
    let live = true;
    fetch(`/api/library/seasons?url=${encodeURIComponent(link)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: unknown) => {
        const parsed = SeasonsSchema.safeParse(body);
        const seasons = parsed.success ? parsed.data.seasons : [];
        if (seasons.length > 0) seasonsFound.set(key, seasons);
        if (live) setAnswer({ key, seasons });
      })
      .catch(() => live && setAnswer({ key, seasons: [] }));
    return () => {
      live = false;
    };
  }, [key, link]);

  if (key === undefined) return [];
  return seasonsFound.get(key) ?? (answer?.key === key ? answer.seasons : undefined);
}

const learned = new Map<string, SeasonDetails | null>();

const keyOf = (link: string, season: number) => `${season}|${link}`;

const asking = new Map<string, Promise<SeasonDetails | null>>();

function askSeason(key: string, link: string, season: number): Promise<SeasonDetails | null> {
  const going = asking.get(key);
  if (going) return going;
  const question = fetch(`/api/library/episodes?season=${season}&url=${encodeURIComponent(link)}`)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((body: unknown): SeasonDetails | null => {
      const parsed = EpisodeDetailsSchema.safeParse(body);
      const details = parsed.success && parsed.data.episodes.length > 0 ? new Map(parsed.data.episodes.map((detail) => [detail.episode, detail])) : null;
      if (details) learned.set(key, details);
      return details;
    })
    .catch(() => null)
    .finally(() => asking.delete(key));
  asking.set(key, question);
  return question;
}

export function useEpisodeDetails(link: string | undefined, season: number | undefined): SeasonDetails | null | undefined {
  const key = link !== undefined && season !== undefined ? keyOf(link, season) : undefined;
  const [answer, setAnswer] = useState<{ key: string; details: SeasonDetails | null }>();

  useEffect(() => {
    if (key === undefined || link === undefined || season === undefined || learned.has(key)) return;
    let live = true;
    void askSeason(key, link, season).then((details) => live && setAnswer({ key, details }));
    return () => {
      live = false;
    };
  }, [key, link, season]);

  if (key === undefined) return null;
  if (learned.has(key)) return learned.get(key) ?? null;
  return answer?.key === key ? answer.details : undefined;
}
