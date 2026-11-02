import { createAnimeHeavenAdapter } from "./adapters/animeheaven";
import { createFilmpireAdapter } from "./adapters/filmpire";
import { createSitefilmeAdapter } from "./adapters/sitefilme";
import { createGenericResolver } from "./generic";
import { isPublicAddress } from "./ip";
import { providerFetch } from "./providerFetch";
import { ResolverRegistry, type RegistryLog } from "./registry";
import { safeFetch } from "./safe-fetch";
import type { ResolveFn, SiteAdapter } from "./types";

export type { ResolveFn, ResolveResult } from "./types";

export interface ResolverSetup {
  log: RegistryLog;
  /** Tests/dev only (ALLOW_PRIVATE_NETWORK=1): lets the resolver fetch loopback/LAN fixture pages. Never in production. */
  allowPrivateNetwork?: boolean;
  adapters?: SiteAdapter[];
}

export function createResolver({ log, allowPrivateNetwork = false, adapters }: ResolverSetup): ResolveFn {
  const fetchOptions = { isAllowedAddress: allowPrivateNetwork ? () => true : isPublicAddress };
  const generic = createGenericResolver({ fetch: safeFetch, fetchOptions });
  // (The adapters ask the sites they are made for, and those name the next address to ask: they are held to the same addresses as a pasted link.)
  const providers = providerFetch(fetchOptions);
  const activeAdapters = adapters ?? [createFilmpireAdapter({ fetch: providers }), createSitefilmeAdapter(), createAnimeHeavenAdapter({ fetch: providers })];
  return new ResolverRegistry(activeAdapters, generic, log).resolve;
}
