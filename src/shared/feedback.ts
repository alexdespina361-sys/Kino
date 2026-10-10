import type { PlayerState } from "./protocol";

const trackOf = (state: PlayerState["subtitles"], id: number | undefined) => state?.tracks.find((track) => track.id === id);

/** What changed, before it is put into words (so each page can say it in its own language). */
export type ChangeNotice =
  | { kind: "speed"; rate: number }
  | { kind: "subtitlesOff" }
  | { kind: "subtitles"; label: string; lang?: string | undefined }
  | { kind: "audio"; label: string; lang?: string | undefined }
  | { kind: "qualityAuto" }
  | { kind: "quality"; label: string };

/** The notice as a line of English: what `describeChange` says unless it is given other words. */
export function englishNotice(notice: ChangeNotice): string {
  switch (notice.kind) {
    case "speed":
      return `Speed ${notice.rate}×`;
    case "subtitlesOff":
      return "Subtitles off";
    case "subtitles":
      return `Subtitles: ${notice.label}`;
    case "audio":
      return `Audio: ${notice.label}`;
    case "qualityAuto":
      return "Quality: Auto";
    case "quality":
      return `Quality: ${notice.label}`;
  }
}

/**
 * What the player just did that the viewer should be told about: a new speed, subtitle, audio track or quality. The TV shows
 * it over the picture and the phone shows it as a confirmation, whoever pressed the button. Nothing is said for a different
 * video, or for what the player sets up by itself while a video starts.
 */
export function changeNotice(before: PlayerState, after: PlayerState): ChangeNotice | undefined {
  if (before.stream !== after.stream) return undefined;
  const settled = (state: PlayerState) => state.state === "playing" || state.state === "paused";
  if (!settled(before) || !settled(after) || after.currentTime < 1) return undefined;

  if (before.playbackRate !== undefined && after.playbackRate !== undefined && before.playbackRate !== after.playbackRate) {
    return { kind: "speed", rate: after.playbackRate };
  }
  if (before.subtitles && after.subtitles && before.subtitles.current !== after.subtitles.current) {
    const track = trackOf(after.subtitles, after.subtitles.current);
    return after.subtitles.current === -1 || !track?.label ? { kind: "subtitlesOff" } : { kind: "subtitles", label: track.label, lang: track.lang };
  }
  if (before.audio && after.audio && before.audio.current !== after.audio.current) {
    const track = trackOf(after.audio, after.audio.current);
    return track?.label ? { kind: "audio", label: track.label, lang: track.lang } : undefined;
  }
  if (before.quality && after.quality && before.quality.current !== after.quality.current) {
    const label = after.quality.levels.find((level) => level.id === after.quality?.current)?.label;
    return after.quality.current === -1 || !label ? { kind: "qualityAuto" } : { kind: "quality", label };
  }
  return undefined;
}

/** `changeNotice` as one short line (English unless `say` words it differently). */
export function describeChange(before: PlayerState, after: PlayerState, say: (notice: ChangeNotice) => string = englishNotice): string | undefined {
  const notice = changeNotice(before, after);
  return notice && say(notice);
}
