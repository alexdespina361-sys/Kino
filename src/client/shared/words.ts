import { MAX_FOLLOWERS, localTrackLabel, type CaptionPreset, type CaptionSetting, type CaptionStyle, type ChangeNotice, type EnhanceMode, type PlayerState, type ResolveStatus, type StatusWords } from "../../shared";
import { getLanguage, hasKey, t, type Key } from "../i18n";

const NUMBERED_TRACK = /^(Subtitle|Audio) (\d+)$/;
export function trackName(track: { label: string; lang?: string | undefined }, kind: "subtitle" | "audio" = "subtitle", several = false): string {
  const numbered = NUMBERED_TRACK.exec(track.label);
  if (numbered) return t(numbered[1] === "Subtitle" ? "player.subtitleN" : "player.audioN", { n: numbered[2]! });
  if (kind === "audio" && several && (track.lang === "ro" || track.lang === "ron" || /romanian|română|romana/i.test(track.label))) {
    return t("player.roDubTrack");
  }
  return localTrackLabel(track, getLanguage());
}

export const hasAudioChoice = (player: Pick<PlayerState, "audio">): boolean => (player.audio?.tracks.length ?? 0) > 1;

export const tracksTitle = (player: Pick<PlayerState, "audio">): string => t(hasAudioChoice(player) ? "player.audioSubtitles" : "player.subtitles");

export function noticeText(notice: ChangeNotice): string {
  switch (notice.kind) {
    case "speed":
      return t("notice.speed", { rate: notice.rate });
    case "subtitlesOff":
      return t("notice.subtitlesOff");
    case "subtitles":
      return t("notice.subtitles", { label: trackName(notice, "subtitle") });
    case "audio":
      return t("notice.audio", { label: trackName(notice, "audio", true) });
    case "qualityAuto":
      return t("notice.qualityAuto");
    case "quality":
      return t("notice.quality", { label: notice.label });
  }
}

export function syncWords(state: PlayerState["subtitleSync"], moved?: number): string {
  switch (state) {
    case "off":
      return t("player.autoSyncOff");
    case "syncing":
      return t("player.syncSyncing");
    case "synced":
      if (moved === undefined) return t("player.syncDone");
      return Math.abs(moved) < 0.3 ? t("player.syncRight") : t("player.syncMoved", { seconds: Math.abs(moved).toFixed(1) });
    case "unavailable":
      return t("player.syncUnavailable");
    default:
      return t("player.autoSyncOn");
  }
}

export function qualityName(quality: PlayerState["quality"]): string {
  if (!quality) return t("player.auto");
  const label = (id: number | undefined) => quality.levels.find((level) => level.id === id)?.label;
  if (quality.current !== -1) return label(quality.current) ?? "HD";
  const active = label(quality.active);
  return active ? `${t("player.auto")} · ${active}` : t("player.auto");
}

export const enhanceName = (mode: EnhanceMode): string => t(mode === "2k" ? "player.enhance2k" : "player.enhanceOff");

export const hasPictureChoice = (player: Pick<PlayerState, "quality" | "enhance">): boolean =>
  Boolean((player.quality && player.quality.levels.length > 1) || (player.enhance?.offers.length ?? 0) > 0);

export function pictureName(player: Pick<PlayerState, "quality" | "enhance">): string {
  const on = player.enhance && player.enhance.current !== "off" ? enhanceName(player.enhance.current) : "";
  if (!player.quality || player.quality.levels.length <= 1) return on || player.quality?.levels[0]?.label || enhanceName("off");
  return on ? `${qualityName(player.quality)} · ${on}` : qualityName(player.quality);
}

export const statusWords = (): StatusWords => ({ watched: t("card.watched"), left: (n) => t("player.minLeft", { n }) });

export const captionTitle = (setting: CaptionSetting): string => t(`caption.${setting}` as Key);
export function captionLabel<S extends CaptionSetting>(setting: S, value: CaptionStyle[S]): string {
  if (setting === "textOpacity") return `${value}%`;
  if (setting === "background") return value === "0" ? t("caption.none") : value === "100" ? t("caption.solid") : `${value}%`;
  if (setting === "edge" && value === "none") return t("caption.none");
  return t(`caption.${setting}.${value}` as Key);
}

export const captionPresetName = (preset: CaptionPreset): string => t(`player.capPreset.${preset}` as Key);

export function friendlyError(code: string | undefined): string {
  const key = `playerError.${code}`;
  return t(hasKey(key) ? key : "playerError.generic");
}

export function socketError(code: string, message: string): string {
  if (code === "BAD_MESSAGE") return t("phone.outdatedServer");
  const key = `ws.${code}`;
  return hasKey(key) ? t(key, { count: MAX_FOLLOWERS + 1 }) : message;
}

const KNOWN_FAILURES: Record<string, Key> = {
  "That doesn't look like a link I can open.": "resolve.invalidUrl",
  "The TV is offline.": "resolve.tvOffline",
  "Something went wrong while looking for the video.": "resolve.wentWrong",
  "The website is having trouble right now. Try again in a moment.": "resolve.siteTrouble",
  "That page couldn't be opened (it may have moved or require a login).": "resolve.pageClosed",
  "The website didn't respond in time. Try again in a moment.": "resolve.siteTimeout",
  "Couldn't find a compatible video source. This website is currently unsupported.": "resolve.unsupportedSite",
  "This is taking too long. Try again in a moment.": "phone.tooSlow",
};

export function resolveFailure(status: Extract<ResolveStatus, { phase: "failed" }>): string {
  const known = KNOWN_FAILURES[status.message];
  if (known) return t(known);
  if (getLanguage() === "en") return status.message;
  return t(status.reason === "unsupported" ? "resolve.unsupported" : "resolve.temporary");
}
