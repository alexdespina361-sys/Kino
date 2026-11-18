import { useEffect, useMemo, useRef, useState } from "react";
import { believableSkipTimes, mergeSkipTimes, SKIP_PARTS, skipTimesOf, type NormalizedMedia, type SkipTimes } from "../../shared";

export const AUTO_SKIP_SECONDS = 5;
export const FRESH_MS = 10_000;
export const SKIP_SHOWN_MS = 5_000;
const CREDITS_TO_END = 5;
const AGAIN_BEFORE = 5;

export type SkipKind = "intro" | "recap" | "credits";

export interface Segment {
  kind: SkipKind;
  start: number;
  end: number;
  key: string;
}

export function creditsRunToEnd(skips: SkipTimes | undefined, duration: number): boolean {
  return Boolean(skips?.outro && skips.outro.end >= duration - CREDITS_TO_END);
}

export function nextButtonFrom(skips: SkipTimes | undefined, duration: number, seconds: number): number {
  const late = duration - seconds;
  return skips?.outro && creditsRunToEnd(skips, duration) ? Math.min(skips.outro.start, late) : late;
}

export function segmentAt(skips: SkipTimes | undefined, time: number, duration: number, hasNext: boolean): Segment | null {
  if (!skips || !(duration > 0)) return null;
  for (const part of SKIP_PARTS) {
    const its = skips[part];
    if (!its) continue;
    if (part === "outro" && hasNext && creditsRunToEnd(skips, duration)) continue;
    if (time >= its.start && time < its.end - 0.5) return { kind: part === "outro" ? "credits" : part, start: its.start, end: its.end, key: `${part}:${its.start}` };
  }
  return null;
}

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
      .catch(() => {});
    return () => controller.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const own = sourceIndex === 0 ? media?.skip : undefined;
    const aniSkip = found && found.key === key ? found.skip : undefined;
    return believableSkipTimes(mergeSkipTimes(own, aniSkip), duration);
  }, [media, sourceIndex, found, key, duration]);
}

export interface SkipView {
  kind: SkipKind;
  fresh: boolean;
  seconds: number | null;
  total: number;
  goesIn?: number;
  shownFor?: number;
}

export interface SkipControl {
  view: SkipView | null;
  press(): boolean;
  back(): boolean;
  skip(): void;
  dismiss(): void;
}

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
  const [done, setDone] = useState<Array<{ key: string; start: number }>>([]);
  const [entered, setEntered] = useState<{ key: string; byPlaying: boolean; freshUntil: number } | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const lastTimeRef = useRef(time);
  const landedRef = useRef<number | null>(null);
  const [, setTick] = useState(0);

  const key = segment && !done.some((each) => each.key === segment.key) ? segment.key : null;

  useEffect(() => {
    const last = lastTimeRef.current;
    lastTimeRef.current = time;
    const landing = landedRef.current;
    const landed = landing !== null && time >= landing - 0.5 && time - landing < 3;
    if (landing !== null && time - landing >= 3) landedRef.current = null;
    if (!segment) {
      if (entered) setEntered(null);
      if (count !== null) setCount(null);
      return;
    }
    if (entered?.key === segment.key) return;
    const byPlaying = ((time >= last && time - last < 3) || landed) && time - segment.start < 4;
    if (landed) landedRef.current = null;
    setEntered({ key: segment.key, byPlaying, freshUntil: byPlaying ? Date.now() + SKIP_SHOWN_MS : 0 });
    setCount(byPlaying && autoSkip ? AUTO_SKIP_SECONDS : null);
  }, [time, segment?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (done.length === 0) return;
    const kept = done.filter((each) => time >= each.start - AGAIN_BEFORE);
    if (kept.length !== done.length) setDone(kept);
  }, [time, done]);

  const videoRef = useRef(video);
  useEffect(() => {
    if (videoRef.current === video) return;
    videoRef.current = video;
    setDone([]);
    setEntered(null);
    setCount(null);
  }, [video]);

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
    const to = Math.min(segment.end, Math.max(0, duration - 0.1));
    landedRef.current = to;
    onSkipTo(to);
  };
  const dismissNow = () => {
    if (!segment) return;
    setDone((before) => [...before.filter((each) => each.key !== segment.key), { key: segment.key, start: segment.start }]);
    setCount(null);
  };

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
  const fading = fresh && !filling;
  useEffect(() => {
    if (!fading) return;
    const timer = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, [fading]);
  const goesIn = fading && entered ? Math.max(0, Math.ceil((entered.freshUntil - Date.now()) / 1000)) : null;
  const view: SkipView | null = key && segment ? { kind: segment.kind, fresh, seconds: filling ? count : null, total: AUTO_SKIP_SECONDS, ...(goesIn !== null ? { goesIn, shownFor: SKIP_SHOWN_MS / 1000 } : {}) } : null;
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
