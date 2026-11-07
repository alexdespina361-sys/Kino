import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One look-up (one call of the registry's `resolve`), as the code that runs for it sees it: the adapter and whatever it asks for the title run inside
 * `runLookup`, and `currentLookup()` gives them this wherever they are, without it being passed from hand to hand.
 *  - `signal` ends when the look-up is over, answered or given up on (see `ResolverRegistry`'s deadline): a question still on its way is then cut off, and
 *    nothing goes on asking in the background for an answer nobody will read.
 *  - `prefetch`: the look-up is one made ahead of time (the next episode), not for a screen that waits.
 *  - `upstream` counts the questions asked of other sites (through `providerFetch`), by host: what the registry logs with the look-up, so that a slow one
 *    says where its time went. Hosts only, never a path or a query.
 */
export interface Lookup {
  signal: AbortSignal;
  prefetch: boolean;
  upstream: { requests: number; ms: number; hosts: Map<string, { requests: number; ms: number }> };
}

/** What the registry writes about a look-up's questions: how many, their time in all, and the host that took longest. */
export interface UpstreamSummary {
  requests: number;
  ms: number;
  slowest?: { host: string; ms: number };
}

const storage = new AsyncLocalStorage<Lookup>();

export function newLookup(signal: AbortSignal, prefetch = false): Lookup {
  return { signal, prefetch, upstream: { requests: 0, ms: 0, hosts: new Map() } };
}

/** Runs `fn` as part of `lookup`: everything it awaits sees `lookup` through `currentLookup()`. */
export function runLookup<T>(lookup: Lookup, fn: () => Promise<T>): Promise<T> {
  return storage.run(lookup, fn);
}

/** The look-up the code that calls this is part of, if any (nothing outside a resolve, as in a test that calls an adapter directly). */
export function currentLookup(): Lookup | undefined {
  return storage.getStore();
}

/** Writes down one question asked of `host` that took `ms`, against the look-up under way (none: nothing is written). */
export function noteUpstream(host: string, ms: number): void {
  const lookup = storage.getStore();
  if (!lookup) return;
  const { upstream } = lookup;
  upstream.requests += 1;
  upstream.ms += ms;
  const seen = upstream.hosts.get(host) ?? { requests: 0, ms: 0 };
  seen.requests += 1;
  seen.ms += ms;
  upstream.hosts.set(host, seen);
}

/** The questions of `lookup` in a few numbers, or undefined when none was asked. */
export function upstreamSummary(lookup: Lookup): UpstreamSummary | undefined {
  const { upstream } = lookup;
  if (upstream.requests === 0) return undefined;
  let slowest: UpstreamSummary["slowest"];
  for (const [host, seen] of upstream.hosts) {
    if (!slowest || seen.ms > slowest.ms) slowest = { host, ms: seen.ms };
  }
  return { requests: upstream.requests, ms: Math.round(upstream.ms), ...(slowest ? { slowest: { host: slowest.host, ms: Math.round(slowest.ms) } } : {}) };
}

/** `signal` and the look-up's own together: whichever ends first ends the question. */
export function withLookupSignal(signal?: AbortSignal | null): AbortSignal | undefined {
  const lookup = storage.getStore();
  if (!lookup) return signal ?? undefined;
  return signal ? AbortSignal.any([signal, lookup.signal]) : lookup.signal;
}
