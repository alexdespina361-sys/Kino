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

/** What is left of a video in the units a person would say: "2 h", "1 h 12 min", "23 min" (never less than a minute). */
export function formatLeft(seconds: number): string {
  const minutes = Math.max(1, Math.round((Number.isFinite(seconds) ? seconds : 0) / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? (rest > 0 ? `${hours} h ${rest} min` : `${hours} h`) : `${minutes} min`;
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

/** "482731" -> "482 731" */
export function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** "ABCD2345" -> "ABCD-2345": the sign-in code of a TV, in two halves that are easy to read out and compare. */
export function formatLinkCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
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
