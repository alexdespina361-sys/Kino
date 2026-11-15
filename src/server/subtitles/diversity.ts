import { normalizeLang } from "../../shared/lang";
import { releaseRank } from "../../shared/tracks";
import type { SubtitleTrack } from "../../shared/media";
import { subtitleQualityScore } from "../resolvers/adapters/filmpire";

export type SubtitleSource =
  | "official"
  | "provider"
  | "opensubtitles"
  | "romanian"
  | "tvsubtitles"
  | "subdl";

export interface CandidateSubtitleTrack extends SubtitleTrack {
  source?: SubtitleSource;
  score?: number;
}

/**
 * Infers the origin source of a subtitle track from its URL or label.
 */
export function inferSubtitleSource(track: SubtitleTrack & { source?: SubtitleSource }): SubtitleSource {
  if (track.source) return track.source;
  const u = (track.url || "").toLowerCase();
  const l = (track.label || "").toLowerCase();

  if (u.includes("/api/subtitles/official/") || l.includes("kino official")) {
    return "official";
  }
  if (u.includes("/api/subtitles/ro/") || l.includes("subs.ro") || l.includes("subtitrari-noi") || l.includes("retail / subtitrari")) {
    return "romanian";
  }
  if (u.includes("/api/subtitles/fallback/") || u.includes("tvsubtitles") || l.includes("tvsubtitles")) {
    return "tvsubtitles";
  }
  if (u.includes("subdl") || l.includes("subdl")) {
    return "subdl";
  }
  if (u.includes("opensubtitles") || l.includes("opensubtitles")) {
    return "opensubtitles";
  }
  return "provider";
}

/**
 * Calculates a composite quality score for a subtitle track based on release rank and keyword scores.
 */
export function computeTrackScore(track: SubtitleTrack): number {
  const label = track.label || "";
  const rank = releaseRank(label); // 0 (WEB) is best, 1 (BluRay), 2 (DVD), 3 (Other), 4 (Partial)
  const baseRankScore = (4 - Math.min(rank, 4)) * 25; // 0..100
  const keywordScore = subtitleQualityScore(label); // -10..+18
  return baseRankScore + keywordScore;
}

const KNOWN_LANG_CODES = new Set([
  "en", "es", "fr", "de", "it", "pt", "ro", "ru", "ar", "tr", "pl", "nl", "sq",
  "el", "hu", "cs", "sr", "hr", "bg", "he", "hi", "zh", "ja", "ko", "sv", "no",
  "da", "fi", "uk", "id", "vi", "th"
]);

export function isRecognizedLang(code: string | undefined): boolean {
  if (!code) return false;
  const raw = code.trim().toLowerCase();
  const norm = normalizeLang(raw);
  if (!norm) return false;
  return KNOWN_LANG_CODES.has(norm) || /^[a-z]{2}$/.test(norm);
}

export function trackLanguageKey(track: SubtitleTrack): string {
  if (track.lang) {
    const norm = normalizeLang(track.lang);
    if (norm) return norm;
  }
  const firstWord = track.label.split(/[\s·:–—(-]/)[0]?.trim().toLowerCase();
  if (firstWord && isRecognizedLang(firstWord)) {
    return normalizeLang(firstWord)!;
  }
  return track.label.trim().toLowerCase() || "und";
}

export interface DiverseFilterOptions {
  maxFromBestSource?: number; // default: 3
  maxFromOtherSource?: number; // default: 1
  /** A language keeps at least this many when it has them, whatever their sources (default: 3): one good source and one crowd file is not a choice. */
  minPerLanguage?: number;
  maxTotal?: number; // default: 40
}

/**
 * Selects a balanced, high-coverage set of subtitle tracks:
 * - Groups by normalized language.
 * - For each language: chooses top 3 tracks from the best source, and top 1 track from each other source (3-5 tracks per language).
 * - Prioritizes official languages (English and Romanian) first.
 * - Caps total tracks at maxTotal (default: 40).
 */
export function filterDiverseSubtitles(
  rawTracks: Array<CandidateSubtitleTrack>,
  options: DiverseFilterOptions = {},
): SubtitleTrack[] {
  const maxFromBest = options.maxFromBestSource ?? 3;
  const maxFromOther = options.maxFromOtherSource ?? 1;
  const minPerLanguage = options.minPerLanguage ?? 3;
  const maxTotal = options.maxTotal ?? 40;

  // 1. Deduplicate by URL
  const seenUrls = new Set<string>();
  const uniqueTracks: CandidateSubtitleTrack[] = [];
  for (const track of rawTracks) {
    if (!track.url || seenUrls.has(track.url)) continue;
    seenUrls.add(track.url);
    const source = inferSubtitleSource(track);
    const score = track.score ?? computeTrackScore(track);
    uniqueTracks.push({
      ...track,
      source,
      score,
    });
  }

  // 2. Group by normalized language
  const byLanguage = new Map<string, CandidateSubtitleTrack[]>();
  for (const track of uniqueTracks) {
    const lang = trackLanguageKey(track);
    const list = byLanguage.get(lang) || [];
    list.push(track);
    byLanguage.set(lang, list);
  }

  // 3. For each language, pick top 3 from best source + top 1 from each other source
  const languagePicks = new Map<string, CandidateSubtitleTrack[]>();

  for (const [lang, tracks] of byLanguage.entries()) {
    // Group tracks of this language by source
    const bySource = new Map<SubtitleSource, CandidateSubtitleTrack[]>();
    for (const track of tracks) {
      const src = track.source || "provider";
      const srcList = bySource.get(src) || [];
      srcList.push(track);
      bySource.set(src, srcList);
    }

    // Sort each source's tracks by score descending
    for (const srcList of bySource.values()) {
      srcList.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    // Determine the "best source" for this language
    // Priority order:
    // For Romanian: romanian > official > provider > opensubtitles > tvsubtitles > subdl
    // For others: official > provider > opensubtitles > tvsubtitles > subdl > romanian
    const priorityOrder: SubtitleSource[] = lang === "ro"
      ? ["romanian", "official", "provider", "opensubtitles", "tvsubtitles", "subdl"]
      : ["official", "provider", "opensubtitles", "tvsubtitles", "subdl", "romanian"];

    let bestSource: SubtitleSource | undefined;
    for (const cand of priorityOrder) {
      if (bySource.has(cand) && (bySource.get(cand)?.length ?? 0) > 0) {
        bestSource = cand;
        break;
      }
    }
    if (!bestSource) {
      bestSource = bySource.keys().next().value;
    }

    // The best source's picks come first, in its own order of quality: the stream's own captions (or Kino Official) stay ahead of crowd files, as before.
    const fromBest = bestSource && bySource.has(bestSource) ? bySource.get(bestSource)!.slice(0, maxFromBest) : [];

    // Then the best of every other source, by score (in the order of `priorityOrder` when level).
    const others = [...bySource.entries()].filter(([src]) => src !== bestSource);
    others.sort(([a], [b]) => priorityOrder.indexOf(a) - priorityOrder.indexOf(b));
    const fromOthers = others.flatMap(([, list]) => list.slice(0, maxFromOther));
    fromOthers.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const selectedForLang = [...fromBest, ...fromOthers];
    // A language with few sources keeps at least `minPerLanguage` files when it has them: the next best of what is left.
    if (selectedForLang.length < minPerLanguage) {
      const chosen = new Set(selectedForLang);
      const rest = tracks.filter((track) => !chosen.has(track)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      selectedForLang.push(...rest.slice(0, minPerLanguage - selectedForLang.length));
    }
    languagePicks.set(lang, selectedForLang);
  }

  // 4. Order languages: English ("en") first, Romanian ("ro") second, then others alphabetically
  const sortedLangKeys = [...languagePicks.keys()].sort((a, b) => {
    const pA = a === "en" ? 0 : a === "ro" ? 1 : 2;
    const pB = b === "en" ? 0 : b === "ro" ? 1 : 2;
    if (pA !== pB) return pA - pB;
    return a.localeCompare(b);
  });

  // 5. Flatten, cap at maxTotal, assign clean sequential IDs
  const finalTracks: SubtitleTrack[] = [];
  for (const lang of sortedLangKeys) {
    const picks = languagePicks.get(lang) || [];
    for (const t of picks) {
      if (finalTracks.length >= maxTotal) break;
      finalTracks.push({
        id: finalTracks.length,
        url: t.url,
        label: t.label.slice(0, 100),
        ...(t.lang ? { lang: t.lang.slice(0, 20) } : {}),
      });
    }
    if (finalTracks.length >= maxTotal) break;
  }

  return finalTracks;
}
