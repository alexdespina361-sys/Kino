import { createAnimeHeavenAdapter } from "./adapters/animeheaven";
import { createFilmpireAdapter } from "./adapters/filmpire";
import { createSitefilmeAdapter } from "./adapters/sitefilme";
import { createGenericResolver } from "./generic";
import { isPublicAddress } from "./ip";
import { providerFetch } from "./providerFetch";
import { ResolverRegistry, type RegistryLog, type RegistryOptions } from "./registry";
import { safeFetch } from "./safe-fetch";
import type { ResolveFn, SiteAdapter } from "./types";

export type { ResolveFn, ResolveResult } from "./types";

export interface ResolverSetup {
  log: RegistryLog;
  /** Tests/dev only (ALLOW_PRIVATE_NETWORK=1): lets the resolver fetch loopback/LAN fixture pages. Never in production. */
  allowPrivateNetwork?: boolean;
  adapters?: SiteAdapter[];
  /** How long a look-up may take, and how long after an episode its next is looked up ahead (see `ResolverRegistry`). Without them, the environment's `RESOLVE_TIMEOUT_MS`, or the defaults. */
  registry?: RegistryOptions;
}

/** `RESOLVE_TIMEOUT_MS` from the environment, when it is a number of milliseconds that makes sense (5 s to 5 min); otherwise nothing, and the default holds. */
export function deadlineFromEnv(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const value = Number(env.RESOLVE_TIMEOUT_MS);
  return Number.isInteger(value) && value >= 5_000 && value <= 300_000 ? value : undefined;
}

export function createResolver({ log, allowPrivateNetwork = false, adapters, registry }: ResolverSetup): ResolveFn {
  const fetchOptions = { isAllowedAddress: allowPrivateNetwork ? () => true : isPublicAddress };
  const generic = createGenericResolver({ fetch: safeFetch, fetchOptions });
  // (The adapters ask the sites they are made for, and those name the next address to ask: they are held to the same addresses as a pasted link.)
  const providers = providerFetch(fetchOptions);
  const activeAdapters = adapters ?? [createFilmpireAdapter({ fetch: providers }), createSitefilmeAdapter(), createAnimeHeavenAdapter({ fetch: providers })];
  const fromEnv = deadlineFromEnv();
  const options: RegistryOptions = { ...(fromEnv !== undefined ? { deadlineMs: fromEnv } : {}), ...registry };
  return new ResolverRegistry(activeAdapters, generic, log, Date.now, options).resolve;
}
