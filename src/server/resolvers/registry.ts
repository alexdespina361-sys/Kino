import { completeSeries, isHttpUrl } from "../../shared";
import type { ResolveFn, ResolveResult, Resolver, SiteAdapter } from "./types";

export interface RegistryLog {
  info(object: Record<string, unknown>, message: string): void;
}

/**
 * URL -> domain lookup -> specific adapter if one exists, otherwise the generic resolver.
 * Adding a supported website = writing one SiteAdapter and passing it in.
 */
export class ResolverRegistry {
  private readonly cache = new Map<string, { result: ResolveResult; expiresAt: number }>();

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

  resolve: ResolveFn = async (raw, isPrefetch = false) => {
    if (!isHttpUrl(raw)) return { status: "invalid_url" };

    const started = this.now();
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
      this.cache.set(raw, { result, expiresAt: started + 600_000 }); // 10 min cache
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
