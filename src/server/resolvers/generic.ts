import { MAX_ALTERNATES, type AlternateSource, type NormalizedMedia } from "../../shared";
import { extractMedia, streamTypeOf } from "./html-extract";
import { noteUpstream, withLookupSignal } from "./lookup";
import { SafeFetchError, type SafeFetch, type SafeFetchOptions } from "./safe-fetch";
import { UNSUPPORTED_MESSAGE, type Candidate, type ResolveResult, type Resolver } from "./types";

export interface GenericOptions {
  fetch: SafeFetch;
  fetchOptions?: SafeFetchOptions;
}

/** SafeFetchError -> the user-facing result state. Never leaks internals (addresses, stack, resolver details). */
export function resultFromFetchError(error: unknown): ResolveResult {
  if (!(error instanceof SafeFetchError)) return { status: "temporary_failure", reason: "Something went wrong while looking for the video." };
  switch (error.code) {
    case "invalid_url":
    case "blocked":
      return { status: "invalid_url" };
    case "bad_status":
      return error.status === 429 || (error.status ?? 0) >= 500
        ? { status: "temporary_failure", reason: "The website is having trouble right now. Try again in a moment." }
        : { status: "unsupported", reason: "That page couldn't be opened (it may have moved or require a login)." };
    default:
      return { status: "temporary_failure", reason: "The website didn't respond in time. Try again in a moment." };
  }
}

function titleFromUrl(url: URL): string | undefined {
  try {
    const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
    const base = last.replace(/\.[a-z0-9]+$/i, "").replace(/[-_.]+/g, " ").trim();
    return base ? base.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

const success = (media: NormalizedMedia, resolver: string): ResolveResult => ({ status: "success", media, resolver });

/**
 * The streams after the best one, as the TV offers them when that does not play: no more than `MAX_ALTERNATES`, none twice and not the best one again.
 * Taken one by one until there are enough, each address looked up in a set: a page can list tens of thousands of them, and asking "is it in the list before
 * it" of every one costs the square of that (13 seconds of the whole server for a page of 2 MiB). Exported for the tests.
 */
export function alternatesOf(candidates: Candidate[], best: Candidate): AlternateSource[] {
  const alternates: AlternateSource[] = [];
  const taken = new Set([best.url]);
  for (const candidate of candidates) {
    if (alternates.length >= MAX_ALTERNATES) break;
    if (taken.has(candidate.url)) continue;
    taken.add(candidate.url);
    alternates.push({ stream: { url: candidate.url, type: candidate.type }, ...(candidate.subtitles ? { subtitles: candidate.subtitles } : {}) });
  }
  return alternates;
}

/**
 * Deterministic, conservative discovery for sites we have no adapter for:
 *   1. the URL itself is a media file          (no network)
 *   2. the URL serves media directly           (content-type)
 *   3. the page declares media in plain HTML    (<video>, JSON-LD, Open Graph, media URLs)
 */
export function createGenericResolver({ fetch, fetchOptions }: GenericOptions): Resolver {
  return {
    id: "generic",
    async resolve(url) {
      const directType = streamTypeOf(url.href);
      if (directType) {
        return success({ title: titleFromUrl(url), stream: { url: url.href, type: directType } }, "generic:direct-media");
      }

      // (Asked as part of a look-up: cut off with it when it is given up on, and counted against it, as the adapters' questions are. See `lookup.ts`.)
      let page;
      const started = performance.now();
      try {
        page = await fetch(url, { ...fetchOptions, signal: withLookupSignal(fetchOptions?.signal) });
      } catch (error) {
        noteUpstream(url.hostname, performance.now() - started);
        return resultFromFetchError(error);
      }
      noteUpstream(url.hostname, performance.now() - started);

      const servedType = streamTypeOf(page.url.href, page.contentType);
      if (servedType && !page.body) {
        return success({ title: titleFromUrl(page.url), stream: { url: page.url.href, type: servedType } }, "generic:direct-media");
      }

      const { title, candidates } = extractMedia(page.body, page.url);
      const best = candidates[0];
      if (!best) return { status: "unsupported", reason: UNSUPPORTED_MESSAGE };
      // The other streams the page declares are fallbacks: if the best guess doesn't play, the TV tries them.
      const alternates = alternatesOf(candidates, best);
      return success(
        {
          title,
          stream: { url: best.url, type: best.type },
          subtitles: best.subtitles,
          ...(alternates.length ? { alternates } : {}),
        },
        `generic:${best.strategy}`,
      );
    },
  };
}
