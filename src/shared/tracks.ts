import { languageName, normalizeLang } from "./lang";
import { OFFICIAL_NAME } from "./official";

export interface TrackLike {
  id: number | string;
  label: string;
  lang?: string | undefined;
}

export interface TrackGroup<T extends TrackLike = TrackLike> {
  key: string;
  name: string;
  tracks: T[];
}

export function groupTracks<T extends TrackLike>(tracks: readonly T[], locale = "en", other = "Other"): TrackGroup<T>[] {
  const groups = new Map<string, TrackGroup<T>>();
  for (const track of tracks) {
    const key = normalizeLang(track.lang) ?? "und";
    let group = groups.get(key);
    if (!group) {
      group = { key, name: key === "und" ? other : (languageName(key, locale) ?? key.toUpperCase()), tracks: [] };
      groups.set(key, group);
    }
    group.tracks.push(track);
  }
  return [...groups.values()];
}

export function preferredLanguages(chosen: readonly string[] | undefined, uiLanguage: string): string[] {
  const list = chosen && chosen.length > 0 ? chosen : [uiLanguage, "en", "ro", "it"];
  return [...new Set(list.map((code) => normalizeLang(code) ?? code))];
}

export function orderGroups<T extends TrackLike>(
  groups: readonly TrackGroup<T>[],
  preferred: readonly string[],
  only = false,
  keep?: string,
): { pinned: TrackGroup<T>[]; more: TrackGroup<T>[] } {
  const pinned = preferred.flatMap((code) => groups.filter((group) => group.key === code));
  const more = groups.filter((group) => !pinned.includes(group));
  return { pinned, more: only && pinned.length > 0 ? more.filter((group) => group.key === keep) : more };
}

export function versionLabel(track: TrackLike, languageNames: string | readonly string[], index: number, fallback = `Version ${index + 1}`): string {
  let label = track.label.trim();
  const named = [languageNames].flat().find((name) => label.toLowerCase().startsWith(name.toLowerCase()));
  if (named !== undefined) label = label.slice(named.length);
  label = label
    .replace(/^\s*\(\d+\)/, "")
    .replace(/^[\s·:–—-]+/, "")
    .replace(/\.(?:srt|vtt|ass|ssa|sub)$/i, "")
    .trim();
  return label || fallback;
}

const word = (pattern: string) => new RegExp(`(?:^|[^a-z0-9])(?:${pattern})(?![a-z0-9])`, "i");
const RELEASES = [word("web(?:-?dl|-?rip)?|amzn|nf|hmax|dsnp|atvp|hulu"), word("blu-?ray|bdrip|brrip|bdremux"), word("dvd[a-z0-9]*")];
const PARTIAL = word("songs?|forced");
const PARTIAL_RANK = RELEASES.length + 1;

export function releaseRank(label: string): number {
  if (label.endsWith(` · ${OFFICIAL_NAME}`)) return -1;
  if (PARTIAL.test(label)) return PARTIAL_RANK;
  const rank = RELEASES.findIndex((kind) => kind.test(label));
  return rank < 0 ? RELEASES.length : rank;
}

export function byRelease<T extends { label: string }>(tracks: readonly T[]): T[] {
  return tracks
    .map((track, index) => ({ track, index, rank: releaseRank(track.label) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ track }) => track);
}

export function defaultTrack<T extends { label: string }>(tracks: readonly T[]): T | undefined {
  const best = byRelease(tracks)[0];
  return best && releaseRank(best.label) < PARTIAL_RANK ? best : undefined;
}

export const formatDelay = (delay: number): string => `${delay > 0 ? "+" : delay < 0 ? "−" : ""}${Math.abs(delay).toFixed(1)}s`;

export const groupOf = <T extends TrackLike>(groups: readonly TrackGroup<T>[], id: number | string | undefined): TrackGroup<T> | undefined =>
  id === undefined ? undefined : groups.find((group) => group.tracks.some((track) => track.id === id));
