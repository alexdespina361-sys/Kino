import { useMemo } from "react";
import { groupOf, groupTracks, languageName, orderGroups, preferredLanguages, type TrackGroup, type TrackLike } from "../../shared";
import { t, useLanguage } from "../i18n";
import { useProfileData } from "./store";

export interface SubtitleLists<T extends TrackLike> {
  /** The languages the video has subtitles in, in the order it lists them. */
  groups: TrackGroup<T>[];
  /** The languages this profile asked for first, in the order it asked for them. */
  pinned: TrackGroup<T>[];
  /** Every other language, under a "More languages" heading (none when the profile wants only its own). */
  more: TrackGroup<T>[];
  /** How many languages the profile's own list leaves out of the picture (only when it asked to see no others). */
  hidden: number;
}

/**
 * The languages of a video's subtitles as this profile wants to read them: its own list first (a guest's is the language of
 * the site, English, Romanian and Italian), then the rest. `playing` is the track on now, whose language is never hidden;
 * `showAll` lifts a profile's "only these" for as long as the list is on screen.
 */
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

/** What a release's own label may start with, to be taken off it (the file says "English", the page may say "Engleză"). */
export const languageNames = (group: TrackGroup): string[] => [group.name, languageName(group.key) ?? group.name];
