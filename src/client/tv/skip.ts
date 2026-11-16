import { useEffect, useMemo, useRef, useState } from "react";
import { believableSkipTimes, mergeSkipTimes, SKIP_PARTS, skipTimesOf, type NormalizedMedia, type SkipTimes } from "../../shared";

/**
 * The Skip button of the player (the owner, 17 Nov: "instead of the current skip to next episode ... a skip button, with a profile setting that auto skips,
 * similar to Netflix"). Where an episode's opening, "previously on" and credits are comes from the source of the video (HiAnime says where its own stream's
 * are) or from AniSkip, asked once the episode plays and its length is known (server/anime/skipTimes.ts), and only what can be believed for a video of that
 * length is kept (shared/skip.ts).
 *
 * - In an opening, a "previously on" or credits the button comes up: bright at first, when the remote's OK presses it and Back turns it down for this time;
 *   after a few seconds it steps back (see-through, whole again under the pointer or with the controls up), and OK is the picture's again.
 * - With the profile's "Skip intros and credits" on, it fills up over a few seconds while the picture plays, and skips when it is full. Back stops it.
 * - Credits that run to the end of an episode with another after it are the Next episode button's (Tv.tsx, its Up Next): it comes when they start.
 * - Skipped or turned down, a part stays so for this pass: winding back into it does not skip it again, only winding back to well before it.
 * - A part that was jumped into (a seek, a film resumed in the middle of its opening) gets the quiet button, never the fill.
 */

/** How long the fill takes, while the picture plays (seconds). */
export const AUTO_SKIP_SECONDS = 5;
/** How long a button that just came up is bright, and the remote's OK presses it. */
export const FRESH_MS = 10_000;
/** Credits that end this close to the end of the episode run to it (else there is something after them: they get Skip credits, and Next episode comes at the end). */
const CREDITS_TO_END = 20;
/** Winding back to this far before a part that was skipped or turned down makes it new again. */
const AGAIN_BEFORE = 5;

export type SkipKind = "intro" | "recap" | "credits";

export interface Segment {
  kind: SkipKind;
  start: number;
  end: number;
  /** The part and where it starts: what "skipped this pass" is kept by. */
  key: string;
}

/** Whether the credits run to the end of the episode. */
export function creditsRunToEnd(skips: SkipTimes | undefined, duration: number): boolean {
  return Boolean(skips?.outro && skips.outro.end >= duration - CREDITS_TO_END);
}

/** When the Next episode button comes (seconds into the video): as the credits start when they run to the end, else `seconds` before the end. */
export function nextButtonFrom(skips: SkipTimes | undefined, duration: number, seconds: number): number {
  const late = duration - seconds;
  return skips?.outro && creditsRunToEnd(skips, duration) ? Math.min(skips.outro.start, late) : late;
}

/** The part being played at `time` that has a Skip button of its own, if any (credits that run to the end before another episode are Next episode's). */
export function segmentAt(skips: SkipTimes | undefined, time: number, duration: number, hasNext: boolean): Segment | null {
  if (!skips || !(duration > 0)) return null;
  for (const part of SKIP_PARTS) {
    const its = skips[part];
    if (!its) continue;
    if (part === "outro" && hasNext && creditsRunToEnd(skips, duration)) continue;
    // (Not in its last half second: a button that comes and goes at once is only a flicker.)
    if (time >= its.start && time < its.end - 0.5) return { kind: part === "outro" ? "credits" : part, start: its.start, end: its.end, key: `${part}:${its.start}` };
  }
  return null;
}

/**
 * Where to skip in the video that plays: its source's own times (only while its main stream plays: they are that stream's) and AniSkip's for an anime the
 * look-up recognised (`media.anime`), asked once the length is known and again if another source turns out to be another cut; only what can be believed for
 * this length. Nothing is asked for a screen that only watches along (`active` false).
 */
export function useSkipTimes(media: NormalizedMedia | null, duration: number, sourceIndex: number, active: boolean): SkipTimes | undefined {
  const anime = media?.anime;
  const length = Math.round(duration);
  const key = active && media && anime && length >= 120 ? `${media.stream.url}|${anime.title}|${anime.season}|${anime.episode}|${length}` : null;
  const [found, setFound] = useState<{ key: string; skip: SkipTimes | undefined } | null>(null);
  useEffect(() => {
    if (!key || !anime) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ title: anime.title, season: String(anime.season), episode: String(anime.episode), length: String(length) });
    fetch(`/api/anime/skip?${query}`, { signal: controller.signal, credentials: "same-origin" })
      .then((answer) => (answer.ok ? (answer.json() as Promise<{ skip?: unknown }>) : null))
      .then((body) => setFound({ key, skip: skipTimesOf(body?.skip) }))
      .catch(() => {}); // (no times: no button)
    return () => controller.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const own = sourceIndex === 0 ? media?.skip : undefined;
    const aniSkip = found && found.key === key ? found.skip : undefined;
    return believableSkipTimes(mergeSkipTimes(own, aniSkip), duration);
  }, [media, sourceIndex, found, key, duration]);
}

/** What the button shows: which part, whether it is bright (just came, or filling), and the fill's seconds left (null: not filling). */
export interface SkipView {
  kind: SkipKind;
  fresh: boolean;
  seconds: number | null;
  total: number;
}

export interface SkipControl {
  view: SkipView | null;
  /** The remote's OK: skips while the button is bright or filling (true), else leaves OK to the picture (false). */
  press(): boolean;
  /** The remote's Back: turns the button down while it is bright or filling (true), else leaves Back as it is. */
  back(): boolean;
  /** The pointer, a finger, the phone: skips whenever the button is up. */
  skip(): void;
  /** Turns the button down for this pass. */
  dismiss(): void;
}

/** The Skip button's state for the video that plays (see above). `enabled` false (a screen that watches along, nothing playing): no button. */
export function useSkipSegment({
  video,
  skips,
  time,
  duration,
  playing,
  hasNext,
  enabled,
  autoSkip,
  onSkipTo,
}: {
  /** Which video plays (its address): what was skipped is forgotten when it changes. */
  video: string | undefined;
  skips: SkipTimes | undefined;
  time: number;
  duration: number;
  playing: boolean;
  hasNext: boolean;
  enabled: boolean;
  autoSkip: boolean;
  onSkipTo: (time: number) => void;
}): SkipControl {
  const segment = enabled ? segmentAt(skips, time, duration, hasNext) : null;
  /** The parts skipped or turned down this pass, with where they start. */
  const [done, setDone] = useState<Array<{ key: string; start: number }>>([]);
  /** The part the picture is in, and whether it played into it (not jumped). */
  const [entered, setEntered] = useState<{ key: string; byPlaying: boolean; freshUntil: number } | null>(null);
  /** Seconds left of the fill, or null. */
  const [count, setCount] = useState<number | null>(null);
  const lastTimeRef = useRef(time);
  const [, setTick] = useState(0);

  const key = segment && !done.some((each) => each.key === segment.key) ? segment.key : null;

  // Coming into a part, by playing into it or by a jump; leaving it.
  useEffect(() => {
    const last = lastTimeRef.current;
    lastTimeRef.current = time;
    if (!segment) {
      if (entered) setEntered(null);
      if (count !== null) setCount(null);
      return;
    }
    if (entered?.key === segment.key) return;
    // (Played into: the time went on as a picture plays, or stood still while the times came, at its start. A seek, or a film resumed in the middle of it,
    // jumped; and so did one whose times came while it was well into the part.)
    const byPlaying = time >= last && time - last < 3 && time - segment.start < 4;
    setEntered({ key: segment.key, byPlaying, freshUntil: byPlaying ? Date.now() + FRESH_MS : 0 });
    setCount(byPlaying && autoSkip ? AUTO_SKIP_SECONDS : null);
  }, [time, segment?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wound back to well before a part that was skipped: it is new again.
  useEffect(() => {
    if (done.length === 0) return;
    const kept = done.filter((each) => time >= each.start - AGAIN_BEFORE);
    if (kept.length !== done.length) setDone(kept);
  }, [time, done]);

  // A new video: nothing of the last one's is kept.
  const videoRef = useRef(video);
  useEffect(() => {
    if (videoRef.current === video) return;
    videoRef.current = video;
    setDone([]);
    setEntered(null);
    setCount(null);
  }, [video]);

  // The bright moment ends (a render then, not only at the next frame of time).
  useEffect(() => {
    if (!entered?.byPlaying) return;
    const wait = entered.freshUntil - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => setTick((n) => n + 1), wait + 20);
    return () => clearTimeout(timer);
  }, [entered]);

  const skipNow = () => {
    if (!segment) return;
    setDone((before) => [...before.filter((each) => each.key !== segment.key), { key: segment.key, start: segment.start }]);
    setCount(null);
    onSkipTo(Math.min(segment.end, Math.max(0, duration - 0.1)));
  };
  const dismissNow = () => {
    if (!segment) return;
    setDone((before) => [...before.filter((each) => each.key !== segment.key), { key: segment.key, start: segment.start }]);
    setCount(null);
  };

  // The fill: a second at a time while the picture plays; full, it skips.
  const filling = key !== null && count !== null;
  useEffect(() => {
    if (!filling || count === null) return;
    if (count <= 0) {
      skipNow();
      return;
    }
    if (!playing) return;
    const timer = setTimeout(() => setCount((left) => (left === null ? null : left - 1)), 1000);
    return () => clearTimeout(timer);
  }, [filling, count, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const fresh = key !== null && entered?.key === key && entered.byPlaying && (filling || Date.now() < entered.freshUntil);
  const view: SkipView | null = key && segment ? { kind: segment.kind, fresh, seconds: filling ? count : null, total: AUTO_SKIP_SECONDS } : null;
  return {
    view,
    press: () => {
      if (!view || !view.fresh) return false;
      skipNow();
      return true;
    },
    back: () => {
      if (!view || !view.fresh) return false;
      dismissNow();
      return true;
    },
    skip: () => {
      if (view) skipNow();
    },
    dismiss: () => {
      if (view) dismissNow();
    },
  };
}
