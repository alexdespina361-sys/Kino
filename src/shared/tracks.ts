import { languageName, normalizeLang } from "./lang";

/** What the menus need to know about an audio or subtitle track. */
export interface TrackLike {
  id: number | string;
  label: string;
  lang?: string | undefined;
}

export interface TrackGroup<T extends TrackLike = TrackLike> {
  /** The language as a comparable code ("en"), or "und" for tracks that name none. */
  key: string;
  /** What to call the language in a menu: "English", or the code itself when it can't be named. */
  name: string;
  tracks: T[];
}

/**
 * One group per language, in the order the languages first appear. A source can offer a dozen releases of the
 * same subtitles; a list of all of them is unusable with a remote, so menus show the languages first. `locale` is the
 * language of the reader (the names come out in it), `other` what to call the tracks that name no language.
 */
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

/**
 * The languages somebody cares about, best first: their own list if they made one, else the language of the site, then
 * English, Romanian and Italian. Each appears once.
 */
export function preferredLanguages(chosen: readonly string[] | undefined, uiLanguage: string): string[] {
  const list = chosen && chosen.length > 0 ? chosen : [uiLanguage, "en", "ro", "it"];
  return [...new Set(list.map((code) => normalizeLang(code) ?? code))];
}

/**
 * The language groups as a person wants to see them: the preferred languages first, in their order, which are `pinned`; then
 * every other language the video has, as it lists them, which are `more`. A preferred language the video has no subtitles in
 * is simply not there. With `only`, the others are left out (unless that would leave nothing to choose from, and except
 * for the language `keep` names, which is the one showing now: a menu never hides what is on).
 */
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

/**
 * What to call one release inside its language, which the menu has already said: "English · The.Film.2023.WEB.srt"
 * becomes "The.Film.2023.WEB", "English (3)" becomes "Version 3". The language may be written in more than one way (the
 * file says "English", the page says "Engleză"); `fallback` is what a release with nothing left to say is called.
 */
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

// A word of a release's name: nothing but letters or digits may touch it on either side. (No lookbehind: older TV browsers cannot parse one.)
const word = (pattern: string) => new RegExp(`(?:^|[^a-z0-9])(?:${pattern})(?![a-z0-9])`, "i");
/** The kinds of release, best fitting first: WEB, then BluRay, then DVD. A name that says none of these comes after them all. */
const RELEASES = [word("web(?:-?dl|-?rip)?|amzn|nf|hmax|dsnp|atvp|hulu"), word("blu-?ray|bdrip|brrip|bdremux"), word("dvd[a-z0-9]*")];
/** A track of only the songs, or only the forced lines: last of all, and never the one turned on by itself. */
const PARTIAL = word("songs?|forced");
const PARTIAL_RANK = RELEASES.length + 1;

/**
 * How well a release's subtitles fit the site's streams as downloaded, 0 best. Measured on 27 English tracks of four titles (the
 * subtitle lab's pick test, 2026-10-17): WEB releases had 93 % of their lines within 1 s, BluRay ones are 1 s early, DVD ones drift
 * (up to minutes by the end), HDRip ones are 0.84 s early.
 */
export function releaseRank(label: string): number {
  if (PARTIAL.test(label)) return PARTIAL_RANK;
  const rank = RELEASES.findIndex((kind) => kind.test(label));
  return rank < 0 ? RELEASES.length : rank;
}

/** The tracks best-fitting release first; within a kind of release, in the order they came. */
export function byRelease<T extends { label: string }>(tracks: readonly T[]): T[] {
  return tracks
    .map((track, index) => ({ track, index, rank: releaseRank(track.label) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ track }) => track);
}

/** The track to turn on when a language is asked for and no release of it: the best-fitting one, never one of only songs or forced lines. */
export function defaultTrack<T extends { label: string }>(tracks: readonly T[]): T | undefined {
  const best = byRelease(tracks)[0];
  return best && releaseRank(best.label) < PARTIAL_RANK ? best : undefined;
}

/** "+0.5s", "−1.0s", "0.0s": a subtitle delay as people read it (positive means later). */
export const formatDelay = (delay: number): string => `${delay > 0 ? "+" : delay < 0 ? "−" : ""}${Math.abs(delay).toFixed(1)}s`;

/** The group a track belongs to, or undefined (the "Off" choice, a track the list no longer has). */
export const groupOf = <T extends TrackLike>(groups: readonly TrackGroup<T>[], id: number | string | undefined): TrackGroup<T> | undefined =>
  id === undefined ? undefined : groups.find((group) => group.tracks.some((track) => track.id === id));
