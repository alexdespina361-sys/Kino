import { useCallback, useEffect, useRef, useState } from "react";
import { useProfileData } from "../account/store";
import { useLanguage } from "../i18n";
import { gifPageOf, klipyAddress, klipyCustomer, klipyKey, klipyLocale, type Gif } from "./gifs";

export function useGifKey(): string | null {
  const child = useProfileData().settings.child === true;
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void klipyKey().then((found) => live && setKey(found));
    return () => {
      live = false;
    };
  }, []);
  return child ? null : key;
}

export type GifStatus = "loading" | "ready" | "failed" | "limited";

export interface GifSearch {
  query: string;
  setQuery: (query: string) => void;
  gifs: Gif[];
  status: GifStatus;
  more: boolean;
  loadMore: () => void;
  retry: () => void;
}

const SETTLE_MS = 400;

export function useGifSearch(key: string): GifSearch {
  const language = useLanguage();
  const strict = useProfileData().settings.child === true;
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [status, setStatus] = useState<GifStatus>("loading");
  const [more, setMore] = useState(false);
  const page = useRef(1);
  const running = useRef<AbortController | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    const wait = window.setTimeout(() => setAsked(query.trim()), query.trim() === asked ? 0 : SETTLE_MS);
    return () => window.clearTimeout(wait);
  }, [query, asked]);

  const fetchPage = useCallback(
    async (words: string, at: number, adding: boolean) => {
      running.current?.abort();
      const control = new AbortController();
      running.current = control;
      setStatus("loading");
      try {
        const answer = await fetch(klipyAddress(key, { query: words, page: at, customer: klipyCustomer(), locale: klipyLocale(language), strict }), {
          signal: control.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (control.signal.aborted) return;
        if (answer.status === 429) return setStatus("limited");
        if (!answer.ok) return setStatus("failed");
        const found = gifPageOf(await answer.json());
        if (control.signal.aborted) return;
        page.current = at;
        setGifs((before) => (adding ? [...before, ...found.gifs] : found.gifs));
        setMore(found.more);
        setStatus("ready");
      } catch {
        if (!control.signal.aborted) setStatus("failed");
      }
    },
    [key, language, strict],
  );

  useEffect(() => {
    setGifs([]);
    setMore(false);
    void fetchPage(asked, 1, false);
    return () => running.current?.abort();
  }, [asked, fetchPage, round]);

  return {
    query,
    setQuery,
    gifs,
    status,
    more,
    loadMore: () => {
      if (status !== "loading" && more) void fetchPage(asked, page.current + 1, true);
    },
    retry: () => setRound((now) => now + 1),
  };
}
