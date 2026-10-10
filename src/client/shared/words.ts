import { MAX_FOLLOWERS, localTrackLabel, type CaptionSetting, type CaptionStyle, type ChangeNotice, type ResolveStatus, type StatusWords } from "../../shared";
import { getLanguage, hasKey, t, type Key } from "../i18n";

/**
 * What the player and the server say, in the words of the page. The player and the server write English (it is what the
 * protocol carries); everything a person reads of it goes through here, so it comes out in the language they chose.
 */

/** "Subtitle 3" and "Audio 2" are what the TV calls a track that says nothing about itself; a track named only by its language is said in the reader's. */
const NUMBERED_TRACK = /^(Subtitle|Audio) (\d+)$/;
export function trackName(track: { label: string; lang?: string | undefined }): string {
  const numbered = NUMBERED_TRACK.exec(track.label);
  if (numbered) return t(numbered[1] === "Subtitle" ? "player.subtitleN" : "player.audioN", { n: numbered[2]! });
  return localTrackLabel(track, getLanguage());
}

/** "Speed 1.5×", "Subtitles: Română": what just changed on the player. */
export function noticeText(notice: ChangeNotice): string {
  switch (notice.kind) {
    case "speed":
      return t("notice.speed", { rate: notice.rate });
    case "subtitlesOff":
      return t("notice.subtitlesOff");
    case "subtitles":
      return t("notice.subtitles", { label: trackName(notice) });
    case "audio":
      return t("notice.audio", { label: trackName(notice) });
    case "qualityAuto":
      return t("notice.qualityAuto");
    case "quality":
      return t("notice.quality", { label: notice.label });
  }
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
