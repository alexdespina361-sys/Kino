import { useMemo } from "react";
import { groupOf, groupTracks, languageName, orderGroups, preferredLanguages, type TrackGroup, type TrackLike } from "../../shared";
import { t, useLanguage } from "../i18n";
import { useProfileData } from "./store";

export interface SubtitleLists<T extends TrackLike> {
  groups: TrackGroup<T>[];
  pinned: TrackGroup<T>[];
  more: TrackGroup<T>[];
  hidden: number;
}

export function useSubtitleLists<T extends TrackLike>(tracks: readonly T[], playing: number | undefined, showAll = false): SubtitleLists<T> {
  const language = useLanguage();
  const { settings } = useProfileData();
  return useMemo(() => {
    const groups = groupTracks(tracks, language, t("player.other"));
    const on = groupOf(groups, playing)?.key;
    const { pinned, more } = orderGroups(groups, preferredLanguages(settings.subtitleLanguages, language), Boolean(settings.onlySubtitleLanguages) && !showAll, on);
    return { groups, pinned, more, hidden: groups.length - pinned.length - more.length };
  }, [tracks, playing, showAll, language, settings.subtitleLanguages, settings.onlySubtitleLanguages]);
}

export const languageNames = (group: TrackGroup): string[] => [group.name, languageName(group.key) ?? group.name];

export const LEAD_LANGUAGES = 3;

export interface FoldedLanguages<T extends TrackLike> {
  lead: TrackGroup<T>[];
  rest: TrackGroup<T>[];
}

export function foldLanguages<T extends TrackLike>(pinned: readonly TrackGroup<T>[], more: readonly TrackGroup<T>[], keep: readonly (string | undefined)[], max = LEAD_LANGUAGES): FoldedLanguages<T> {
  const all = [...pinned, ...more];
  const lead = (pinned.length > 0 ? pinned : more).slice(0, max);
  for (const key of keep) {
    const group = all.find((one) => one.key === key);
    if (group && !lead.includes(group)) lead.push(group);
  }
  const rest = all.filter((group) => !lead.includes(group));
  return rest.length > 1 ? { lead, rest } : { lead: all, rest: [] };
}
