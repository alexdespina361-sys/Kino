import { completeSeries, isHttpUrl } from "../../shared";
import type { ResolveFn, ResolveResult, Resolver, SiteAdapter } from "./types";

export interface RegistryLog {
  info(object: Record<string, unknown>, message: string): void;
}

/**
 * Results kept for ten minutes. The key is whatever address a visitor sent, so without a bound the memory only grows (a link to a plain `.mp4` costs the server
 * nothing to answer). Nor is the number of them the whole of it: a page decides how big its result is, so they are weighed too (their JSON, in characters), and
 * one that is heavier than `MAX_CACHED_RESULT_BYTES` is given to whoever asked and not kept.
 */
export const MAX_CACHED_RESULTS = 500;
export const MAX_CACHED_BYTES = 16 * 1024 * 1024;
export const MAX_CACHED_RESULT_BYTES = 1024 * 1024;

/**
 * URL -> domain lookup -> specific adapter if one exists, otherwise the generic resolver.
 * Adding a supported website = writing one SiteAdapter and passing it in.
 */
export class ResolverRegistry {
  private readonly cache = new Map<string, { result: ResolveResult; expiresAt: number; bytes: number }>();
  private cachedBytes = 0;

  constructor(
    private readonly adapters: SiteAdapter[],
    private readonly generic: Resolver,
    private readonly log: RegistryLog,
    private readonly now: () => number = Date.now,
  ) {}

  /** Adapter responsible for this hostname (exact or subdomain match), if any. */
  adapterFor(url: URL): SiteAdapter | undefined {
    const host = url.hostname.toLowerCase();
    return this.adapters.find((a) => a.domains.some((d) => host === d || host.endsWith(`.${d}`)));
  }

  /** Lets go of what is kept for `raw`. */
  private drop(raw: string): void {
    const old = this.cache.get(raw);
    if (!old) return;
    this.cache.delete(raw); // (a Map keeps the order things were added in: what is kept next is the newest)
    this.cachedBytes -= old.bytes;
  }

  /** Keeps `result` as the newest, and lets the oldest go while there are too many or they weigh too much together. */
  private keep(raw: string, result: ResolveResult, expiresAt: number): void {
    this.drop(raw);
    const bytes = JSON.stringify(result).length;
    if (bytes > MAX_CACHED_RESULT_BYTES) return;
    this.cache.set(raw, { result, expiresAt, bytes });
    this.cachedBytes += bytes;
    for (const [oldest, entry] of this.cache) {
      if (this.cache.size <= MAX_CACHED_RESULTS && this.cachedBytes <= MAX_CACHED_BYTES) break;
      this.cache.delete(oldest);
      this.cachedBytes -= entry.bytes;
    }
  }

  resolve: ResolveFn = async (raw, isPrefetch = false, fresh = false) => {
    if (!isHttpUrl(raw)) return { status: "invalid_url" };

    const started = this.now();
    // (A link that was tried and failed is not given again for the rest of its ten minutes: a stream's own link, with the token that came with it, can run out sooner.)
    if (fresh) this.drop(raw);
    const cached = this.cache.get(raw);
    if (cached && cached.expiresAt > started) {
      return cached.result;
    }

    const url = new URL(raw);
    const resolver = this.adapterFor(url) ?? this.generic;

    let result: ResolveResult;
    try {
      result = await resolver.resolve(url);
    } catch {
      result = { status: "temporary_failure", reason: "Something went wrong while looking for the video." };
    }

    if (result.status === "success") {
      result = { ...result, media: completeSeries({ ...result.media, page: result.media.page ?? raw }) };
      // Filmpire / short-lived upstream provider tokens expire in ~60s; cache for 45s to avoid serving stale tokens.
      const isShortLived = result.resolver === "filmpire" || /filmpire\.(sc|cc)/.test(raw);
      const ttl = isShortLived ? 45_000 : 600_000;
      this.keep(raw, result, started + ttl);
      if (!isPrefetch && result.media.series?.next?.url) {
        // Pre-resolve only the immediate next episode in the background
        const nextUrl = result.media.series.next.url;
        setTimeout(() => {
          if (!this.cache.has(nextUrl)) {
            this.resolve(nextUrl, true).catch(() => {});
          }
        }, 100);
      }
    }

    // Structured event: enough to see why a site fails, never URLs with tokens/cookies (domain only).
    // For a series, how many episodes the resolver listed: 0 here is why the phone and TV have no episode list.
    this.log.info(
      {
        domain: url.hostname,
        resolver: result.status === "success" ? result.resolver : resolver.id,
        success: result.status === "success",
        ...(result.status === "success" && result.media.series && { episodes: result.media.series.episodes?.length ?? 0 }),
        ...(result.status !== "success" && { reason: result.status.toUpperCase() }),
        durationMs: this.now() - started,
      },
      "resolve",
    );
    return result;
  };
}
