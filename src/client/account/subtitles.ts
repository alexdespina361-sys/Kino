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
