import { MAX_FOLLOWERS, localTrackLabel, type CaptionPreset, type CaptionSetting, type CaptionStyle, type ChangeNotice, type EnhanceMode, type PlayerState, type ResolveStatus, type StatusWords } from "../../shared";
import { getLanguage, hasKey, t, type Key } from "../i18n";

/**
 * What the player and the server say, in the words of the page. The player and the server write English (it is what the
 * protocol carries); everything a person reads of it goes through here, so it comes out in the language they chose.
 */

/** "Subtitle 3" and "Audio 2" are what the TV calls a track that says nothing about itself; a track named only by its language is said in the reader's. */
const NUMBERED_TRACK = /^(Subtitle|Audio) (\d+)$/;
// (A Romanian sound track is "dubbed" only beside others: a Romanian film's one sound is its own.)
export function trackName(track: { label: string; lang?: string | undefined }, kind: "subtitle" | "audio" = "subtitle", several = false): string {
  const numbered = NUMBERED_TRACK.exec(track.label);
  if (numbered) return t(numbered[1] === "Subtitle" ? "player.subtitleN" : "player.audioN", { n: numbered[2]! });
  if (kind === "audio" && several && (track.lang === "ro" || track.lang === "ron" || /romanian|română|romana/i.test(track.label))) {
    return t("player.roDubTrack");
  }
  return localTrackLabel(track, getLanguage());
}

/** The film has more than one sound to listen to (the audio languages its stream carries): what makes the menu of tracks "Audio & subtitles" and not just "Subtitles". */
export const hasAudioChoice = (player: Pick<PlayerState, "audio">): boolean => (player.audio?.tracks.length ?? 0) > 1;

/** What the menu of tracks and the button that opens it are called: a film with one sound has nothing to choose there, and the name does not promise it. */
export const tracksTitle = (player: Pick<PlayerState, "audio">): string => t(hasAudioChoice(player) ? "player.audioSubtitles" : "player.subtitles");

/** "Speed 1.5×", "Subtitles: Română": what just changed on the player. */
export function noticeText(notice: ChangeNotice): string {
  switch (notice.kind) {
    case "speed":
      return t("notice.speed", { rate: notice.rate });
    case "subtitlesOff":
      return t("notice.subtitlesOff");
    case "subtitles":
      return t("notice.subtitles", { label: trackName(notice, "subtitle") });
    case "audio":
      return t("notice.audio", { label: trackName(notice, "audio", true) }); // (a change of sound track: there are several)
    case "qualityAuto":
      return t("notice.qualityAuto");
    case "quality":
      return t("notice.quality", { label: notice.label });
  }
}

/**
 * What the switch for timing the subtitles to the sound by itself says: On or Off (its own words: the name of the switch is a feminine noun in
 * Romanian and Italian), and while it is on, how it is going: still checking, in time (and how far it moved the lines, or that they were
 * right), or not possible here.
 */
export function syncWords(state: PlayerState["subtitleSync"], moved?: number): string {
  switch (state) {
    case "off":
      return t("player.autoSyncOff");
    case "syncing":
      return t("player.syncSyncing");
    case "synced":
      if (moved === undefined) return t("player.syncDone");
      // (Under a third of a second nobody sees: the file was right.)
      return Math.abs(moved) < 0.3 ? t("player.syncRight") : t("player.syncMoved", { seconds: Math.abs(moved).toFixed(1) });
    case "unavailable":
      return t("player.syncUnavailable");
    default:
      return t("player.autoSyncOn");
  }
}

/** What the quality button says: the quality that was picked, or "Auto" with the one the player has chosen for itself after it once that is known ("Auto · 720p"). */
export function qualityName(quality: PlayerState["quality"]): string {
  if (!quality) return t("player.auto");
  const label = (id: number | undefined) => quality.levels.find((level) => level.id === id)?.label;
  if (quality.current !== -1) return label(quality.current) ?? "HD";
  const active = label(quality.active);
  return active ? `${t("player.auto")} · ${active}` : t("player.auto");
}

/** What a ✦ choice of the Quality list is called ("✦ 2K"); "off" is "✦ Off". */
export const enhanceName = (mode: EnhanceMode): string =>
  t(mode === "2k" ? "player.enhance2k" : mode === "2k60" ? "player.enhance2k60" : mode === "60" ? "player.enhance60" : "player.enhanceOff");

/** The Quality button is there: the film comes in more than one quality, or this screen offers a ✦ choice for it. */
export const hasPictureChoice = (player: Pick<PlayerState, "quality" | "enhance">): boolean =>
  Boolean((player.quality && player.quality.levels.length > 1) || (player.enhance?.offers.length ?? 0) > 0);

/**
 * What the Quality button says: the quality, and the ✦ choice that is on ("Auto · 720p · ✦ 2K"). A film of one quality has only the ✦ choices to pick
 * from: the one that is on ("✦ 2K"), else its own quality when it says one ("720p"), else "✦ Off" (there is no "Auto" to speak of).
 */
export function pictureName(player: Pick<PlayerState, "quality" | "enhance">): string {
  const on = player.enhance && player.enhance.current !== "off" ? enhanceName(player.enhance.current) : "";
  if (!player.quality || player.quality.levels.length <= 1) return on || player.quality?.levels[0]?.label || enhanceName("off");
  return on ? `${qualityName(player.quality)} · ${on}` : qualityName(player.quality);
}

/** The words of "Watched" and "12 min left" on an episode list. */
export const statusWords = (): StatusWords => ({ watched: t("card.watched"), left: (n) => t("player.minLeft", { n }) });

/** What a subtitle setting is called ("Word spacing") and what each of its choices is ("Wide"). */
export const captionTitle = (setting: CaptionSetting): string => t(`caption.${setting}` as Key);
export function captionLabel<S extends CaptionSetting>(setting: S, value: CaptionStyle[S]): string {
  if (setting === "textOpacity") return `${value}%`;
  if (setting === "background") return value === "0" ? t("caption.none") : value === "100" ? t("caption.solid") : `${value}%`;
  if (setting === "edge" && value === "none") return t("caption.none");
  return t(`caption.${setting}.${value}` as Key);
}

/** What one of the three looks is called ("Large text"). */
export const captionPresetName = (preset: CaptionPreset): string => t(`player.capPreset.${preset}` as Key);

/** Plain words for the error codes the player reports. The raw code stays available for debugging. */
export function friendlyError(code: string | undefined): string {
  const key = `playerError.${code}`;
  return t(hasKey(key) ? key : "playerError.generic");
}

/** An error the socket brought from the server. The server's own sentence is kept for codes this page has no words for. */
export function socketError(code: string, message: string): string {
  if (code === "BAD_MESSAGE") return t("phone.outdatedServer");
  const key = `ws.${code}`;
  return hasKey(key) ? t(key, { count: MAX_FOLLOWERS + 1 }) : message;
}

/** The sentences the server gives when it cannot find a video, which this page can say in its own language. */
const KNOWN_FAILURES: Record<string, Key> = {
  "That doesn't look like a link I can open.": "resolve.invalidUrl",
  "The TV is offline.": "resolve.tvOffline",
  "Something went wrong while looking for the video.": "resolve.wentWrong",
  "The website is having trouble right now. Try again in a moment.": "resolve.siteTrouble",
  "That page couldn't be opened (it may have moved or require a login).": "resolve.pageClosed",
  "The website didn't respond in time. Try again in a moment.": "resolve.siteTimeout",
  "Couldn't find a compatible video source. This website is currently unsupported.": "resolve.unsupportedSite",
  // Said by the phone itself when a lookup never answers (see Controller.tsx).
  "This is taking too long. Try again in a moment.": "phone.tooSlow",
};

/** Why a video was not found. A reason the page knows is said in its language; an unknown one is the server's own words in English, and in another language its kind. */
export function resolveFailure(status: Extract<ResolveStatus, { phase: "failed" }>): string {
  const known = KNOWN_FAILURES[status.message];
  if (known) return t(known);
  if (getLanguage() === "en") return status.message;
  return t(status.reason === "unsupported" ? "resolve.unsupported" : "resolve.temporary");
}
