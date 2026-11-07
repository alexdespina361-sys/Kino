import { completeSeries, isHttpUrl } from "../../shared";
import { newLookup, runLookup, upstreamSummary } from "./lookup";
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
 * How long a look-up may take before it is given up on. A title's page names a player, the player names a list, the list names a module: a look-up is a chain
 * of questions to other sites, each with its own time, and left alone a chain whose every link is slow runs for minutes while the screen shows "Finding the
 * video" and the viewer takes it for broken. Past this it is a failure, said at once, with Try again; the questions still on their way are cut off (see
 * `lookup.ts`). Thirty seconds is twice what a slow look-up that does succeed takes.
 */
export const DEFAULT_RESOLVE_DEADLINE_MS = 30_000;
/**
 * How long after an episode is found its next one is looked up ahead of time. Not at once: the screen is then asking for the first pieces of the film, and
 * the sites that are asked count the questions from one address. The next episode is wanted some twenty minutes on, not in the next second.
 */
export const DEFAULT_PREFETCH_DELAY_MS = 10_000;

export const TOO_LONG: ResolveResult = { status: "temporary_failure", reason: "Finding the video took too long. Try again in a moment." };
const WENT_WRONG: ResolveResult = { status: "temporary_failure", reason: "Something went wrong while looking for the video." };

export interface RegistryOptions {
  /** See `DEFAULT_RESOLVE_DEADLINE_MS`. */
  deadlineMs?: number;
  /** See `DEFAULT_PREFETCH_DELAY_MS`. */
  prefetchDelayMs?: number;
}

/**
 * URL -> domain lookup -> specific adapter if one exists, otherwise the generic resolver.
 * Adding a supported website = writing one SiteAdapter and passing it in.
 *
 * One look-up at a time for one address: a phone and the TV it steers, or a screen and the look-up made ahead for it, asking for the same page within the same
 * moment are answered by the one chain of questions, not two.
 */
export class ResolverRegistry {
  private readonly cache = new Map<string, { result: ResolveResult; expiresAt: number; bytes: number }>();
  private cachedBytes = 0;
  /** The look-ups under way, by address: whoever asks for one of these joins it. */
  private readonly pending = new Map<string, Promise<ResolveResult>>();
  private readonly deadlineMs: number;
  private readonly prefetchDelayMs: number;

  constructor(
    private readonly adapters: SiteAdapter[],
    private readonly generic: Resolver,
    private readonly log: RegistryLog,
    private readonly now: () => number = Date.now,
    options: RegistryOptions = {},
  ) {
    this.deadlineMs = options.deadlineMs ?? DEFAULT_RESOLVE_DEADLINE_MS;
    this.prefetchDelayMs = options.prefetchDelayMs ?? DEFAULT_PREFETCH_DELAY_MS;
  }

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

    // (A link that was tried and failed is not given again for the rest of its ten minutes: a stream's own link, with the token that came with it, can run out sooner.)
    if (fresh) this.drop(raw);
    const cached = this.cache.get(raw);
    if (cached && cached.expiresAt > this.now()) {
      return cached.result;
    }
    // (A look-up under way for this address is as fresh as one can be: whoever asks now waits for it.)
    const underway = this.pending.get(raw);
    if (underway) return underway;

    const lookup = this.lookUp(raw, isPrefetch).finally(() => this.pending.delete(raw));
    this.pending.set(raw, lookup);
    return lookup;
  };

  /** One chain of questions for `raw`, within the deadline, its result kept and logged. */
  private async lookUp(raw: string, isPrefetch: boolean): Promise<ResolveResult> {
    const started = this.now();
    const url = new URL(raw);
    const resolver = this.adapterFor(url) ?? this.generic;

    // (The look-up's questions end with it: when it is answered, or given up on. A chain that is given up on is not left to run on in the background.)
    const control = new AbortController();
    const lookup = newLookup(control.signal, isPrefetch);
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      control.abort();
    }, this.deadlineMs);
    let result: ResolveResult;
    try {
      result = await Promise.race([
        runLookup(lookup, () => resolver.resolve(url)),
        new Promise<ResolveResult>((answer) => control.signal.addEventListener("abort", () => answer(TOO_LONG), { once: true })),
      ]);
    } catch {
      result = WENT_WRONG;
    } finally {
      clearTimeout(deadline);
      control.abort();
    }
    if (timedOut) result = TOO_LONG;

    if (result.status === "success") {
      result = { ...result, media: completeSeries({ ...result.media, page: result.media.page ?? raw }) };
      // Filmpire / short-lived upstream provider tokens expire in ~60s; cache for 45s to avoid serving stale tokens.
      const isShortLived = result.resolver === "filmpire" || /filmpire\.(sc|cc)/.test(raw);
      const ttl = isShortLived ? 45_000 : 600_000;
      this.keep(raw, result, started + ttl);
      if (!isPrefetch && result.media.series?.next?.url) {
        // Pre-resolve only the immediate next episode in the background, a while from now (see `DEFAULT_PREFETCH_DELAY_MS`).
        const nextUrl = result.media.series.next.url;
        const timer = setTimeout(() => {
          if (!this.cache.has(nextUrl) && !this.pending.has(nextUrl)) {
            this.resolve(nextUrl, true).catch(() => {});
          }
        }, this.prefetchDelayMs);
        timer.unref?.();
      }
    }

    // Structured event: enough to see why a site fails, never URLs with tokens/cookies (domain only).
    // For a series, how many episodes the resolver listed: 0 here is why the phone and TV have no episode list.
    // `upstream` is the questions asked of other sites on the way, and the host that took longest: where a slow look-up spent its time.
    const upstream = upstreamSummary(lookup);
    this.log.info(
      {
        domain: url.hostname,
        resolver: result.status === "success" ? result.resolver : resolver.id,
        success: result.status === "success",
        ...(result.status === "success" && result.media.series && { episodes: result.media.series.episodes?.length ?? 0 }),
        ...(result.status !== "success" && { reason: timedOut ? "TIMEOUT" : result.status.toUpperCase() }),
        ...(isPrefetch && { prefetch: true }),
        durationMs: this.now() - started,
        ...(upstream && { upstream }),
      },
      "resolve",
    );
    return result;
  }
}
