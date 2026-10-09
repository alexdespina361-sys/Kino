/** 75 -> "1:15", 4522 -> "1:15:22" */
export function formatTime(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 4522 -> "-1:15:22". Netflix shows what is left, not what is done. */
export function formatRemaining(currentTime: number, duration: number): string {
  return duration > 0 ? `-${formatTime(Math.max(0, duration - currentTime))}` : "";
}

/** A time of day as "21:05" (24 hours, the way a TV clock shows it). */
export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** When the video will be over if it keeps playing at this speed: "21:48". Empty while the length is unknown. */
export function formatEndsAt(currentTime: number, duration: number, rate: number, now: Date): string {
  if (!(duration > 0)) return "";
  const secondsLeft = Math.max(0, duration - currentTime) / (rate > 0 ? rate : 1);
  return formatClock(new Date(now.getTime() + secondsLeft * 1000));
}

/** "https://www.example.com/watch/1?x=2" -> "example.com" */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Plain words for the error codes the player reports. The raw code stays available for debugging. */
export function friendlyError(code: string | undefined): string {
  switch (code) {
    case "SOURCE_NOT_DIRECTLY_PLAYABLE":
      return "This video can't be played on the TV.";
    case "HLS_UNSUPPORTED":
      return "This TV's browser can't play this kind of stream.";
    case "PLAYBACK_BLOCKED":
      return "The TV blocked playback. Press OK on the TV, then try again.";
    default:
      return "Something went wrong while playing this video.";
  }
}

/** "482731" -> "482 731" */
export function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function readStorage(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the app just forgets between loads */
  }
}
