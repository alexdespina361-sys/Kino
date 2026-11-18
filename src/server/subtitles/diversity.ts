import { normalizeLang } from "../../shared/lang";
import { releaseRank } from "../../shared/tracks";
import type { SubtitleTrack } from "../../shared/media";
import { subtitleQualityScore } from "../resolvers/adapters/filmpire";

export type SubtitleSource =
  | "official"
  | "provider"
  | "vixsrc"
  | "opensubtitles"
  | "romanian"
  | "tvsubtitles"
  | "subdl";

export interface CandidateSubtitleTrack extends SubtitleTrack {
  source?: SubtitleSource;
  score?: number;
}

export function inferSubtitleSource(track: SubtitleTrack & { source?: SubtitleSource }): SubtitleSource {
  if (track.source) return track.source;
  const u = (track.url || "").toLowerCase();
  const l = (track.label || "").toLowerCase();

  if (u.includes("/api/subtitles/official/") || l.includes("kino official")) {
    return "official";
  }
  if (u.includes("/api/subtitles/ro/") || l.includes("subs.ro") || l.includes("subtitrari-noi") || l.includes("titrari") || l.includes("retail / subtitrari")) {
    return "romanian";
  }
  if (u.includes("/api/subtitles/fallback/") || u.includes("tvsubtitles") || l.includes("tvsubtitles")) {
    return "tvsubtitles";
  }
  if (u.includes("subdl") || l.includes("subdl")) {
    return "subdl";
  }
  if (u.includes("opensubtitles") || l.includes("opensubtitles") || u.includes("strem.io")) {
    return "opensubtitles";
  }
  if (u.includes("vixsrc") || l.includes("vixsrc")) {
    return "vixsrc";
  }
  return "provider";
}

export function computeTrackScore(track: SubtitleTrack): number {
  const label = track.label || "";
  const rank = releaseRank(label);
  const baseRankScore = (4 - Math.min(rank, 4)) * 25;
  const keywordScore = subtitleQualityScore(label);
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
  maxFromBestSource?: number;
  maxFromOtherSource?: number;
  minPerLanguage?: number;
  maxTotal?: number;
}

export function filterDiverseSubtitles(
  rawTracks: Array<CandidateSubtitleTrack>,
  options: DiverseFilterOptions = {},
): SubtitleTrack[] {
  const maxFromBest = options.maxFromBestSource ?? 3;
  const maxFromOther = options.maxFromOtherSource ?? 1;
  const minPerLanguage = options.minPerLanguage ?? 3;
  const maxTotal = options.maxTotal ?? 40;

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

  const byLanguage = new Map<string, CandidateSubtitleTrack[]>();
  for (const track of uniqueTracks) {
    const lang = trackLanguageKey(track);
    const list = byLanguage.get(lang) || [];
    list.push(track);
    byLanguage.set(lang, list);
  }

  const languagePicks = new Map<string, CandidateSubtitleTrack[]>();

  for (const [lang, tracks] of byLanguage.entries()) {
    const bySource = new Map<SubtitleSource, CandidateSubtitleTrack[]>();
    for (const track of tracks) {
      const src = track.source || "provider";
      const srcList = bySource.get(src) || [];
      srcList.push(track);
      bySource.set(src, srcList);
    }

    for (const srcList of bySource.values()) {
      srcList.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    const priorityOrder: SubtitleSource[] = lang === "ro"
      ? ["romanian", "official", "provider", "vixsrc", "opensubtitles", "tvsubtitles", "subdl"]
      : ["official", "provider", "vixsrc", "opensubtitles", "tvsubtitles", "subdl", "romanian"];

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

    const fromBest = bestSource && bySource.has(bestSource) ? bySource.get(bestSource)!.slice(0, maxFromBest) : [];

    const others = [...bySource.entries()].filter(([src]) => src !== bestSource);
    others.sort(([a], [b]) => priorityOrder.indexOf(a) - priorityOrder.indexOf(b));
    const fromOthers = others.flatMap(([, list]) => list.slice(0, maxFromOther));
    fromOthers.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const selectedForLang = [...fromBest, ...fromOthers];
    if (selectedForLang.length < minPerLanguage) {
      const chosen = new Set(selectedForLang);
      const rest = tracks.filter((track) => !chosen.has(track)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      selectedForLang.push(...rest.slice(0, minPerLanguage - selectedForLang.length));
    }
    languagePicks.set(lang, selectedForLang);
  }

  const sortedLangKeys = [...languagePicks.keys()].sort((a, b) => {
    const pA = a === "en" ? 0 : a === "ro" ? 1 : 2;
    const pB = b === "en" ? 0 : b === "ro" ? 1 : 2;
    if (pA !== pB) return pA - pB;
    return a.localeCompare(b);
  });

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
