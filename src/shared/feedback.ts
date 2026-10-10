import type { PlayerState } from "./protocol";

const trackLabel = (state: PlayerState["subtitles"], id: number | undefined) => state?.tracks.find((track) => track.id === id)?.label;

/**
 * What the player just did that the viewer should be told about, as one short line: a new speed, subtitle, audio track
 * or quality. The TV shows it over the picture and the phone shows it as a confirmation, whoever pressed the button.
 * Nothing is said for a different video, or for what the player sets up by itself while a video starts.
 */
export function describeChange(before: PlayerState, after: PlayerState): string | undefined {
  if (before.stream !== after.stream) return undefined;
  const settled = (state: PlayerState) => state.state === "playing" || state.state === "paused";
  if (!settled(before) || !settled(after) || after.currentTime < 1) return undefined;

  if (before.playbackRate !== undefined && after.playbackRate !== undefined && before.playbackRate !== after.playbackRate) {
    return `Speed ${after.playbackRate}×`;
  }
  if (before.subtitles && after.subtitles && before.subtitles.current !== after.subtitles.current) {
    const label = trackLabel(after.subtitles, after.subtitles.current);
    return after.subtitles.current === -1 || !label ? "Subtitles off" : `Subtitles: ${label}`;
  }
  if (before.audio && after.audio && before.audio.current !== after.audio.current) {
    const label = trackLabel(after.audio, after.audio.current);
    return label ? `Audio: ${label}` : undefined;
  }
  if (before.quality && after.quality && before.quality.current !== after.quality.current) {
    const label = after.quality.levels.find((level) => level.id === after.quality?.current)?.label;
    return after.quality.current === -1 || !label ? "Quality: Auto" : `Quality: ${label}`;
  }
  return undefined;
}
