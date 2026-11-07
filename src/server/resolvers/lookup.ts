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
  upstream: { requests: number; ms: number; timeouts: number; hosts: Map<string, HostSeen> };
}

/** What has been seen of one host over a look-up: how long its connections took to make, how long it took to begin answering, and how often it never did. */
interface HostSeen {
  requests: number;
  ms: number;
  connectingMs: number;
  waitingMs: number;
  timeouts: number;
  address?: string;
}

/** What is known of one question, beyond its time (see `FetchTiming` in safe-fetch.ts). */
export interface UpstreamNote {
  connectMs?: number;
  firstByteMs?: number;
  reused?: boolean;
  address?: string;
  timedOut?: "connect" | "answer";
}

/**
 * What the registry writes about a look-up's questions: how many, their time in all, how many ran out of time, and the host that took longest, with where
 * its time went: making the connection (`connectMs`) or waiting for the answer to begin (`waitMs`).
 */
export interface UpstreamSummary {
  requests: number;
  ms: number;
  timeouts?: number;
  slowest?: { host: string; ms: number; connectMs: number; waitMs: number; timeouts?: number; address?: string };
}

const storage = new AsyncLocalStorage<Lookup>();

export function newLookup(signal: AbortSignal, prefetch = false): Lookup {
  return { signal, prefetch, upstream: { requests: 0, ms: 0, timeouts: 0, hosts: new Map() } };
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
export function noteUpstream(host: string, ms: number, note: UpstreamNote = {}): void {
  const lookup = storage.getStore();
  if (!lookup) return;
  const { upstream } = lookup;
  upstream.requests += 1;
  upstream.ms += ms;
  if (note.timedOut) upstream.timeouts += 1;
  const seen = upstream.hosts.get(host) ?? { requests: 0, ms: 0, connectingMs: 0, waitingMs: 0, timeouts: 0 };
  seen.requests += 1;
  seen.ms += ms;
  // (A connection that was never made took the whole time; one that was, the time until it was, and the answer the time from then to its first byte, or to the end.)
  const connecting = note.timedOut === "connect" ? ms : (note.connectMs ?? 0);
  seen.connectingMs += connecting;
  seen.waitingMs += note.timedOut === "connect" ? 0 : Math.max(0, (note.firstByteMs ?? ms) - connecting);
  if (note.timedOut) seen.timeouts += 1;
  if (note.address) seen.address = note.address;
  upstream.hosts.set(host, seen);
}

/** The questions of `lookup` in a few numbers, or undefined when none was asked. */
export function upstreamSummary(lookup: Lookup): UpstreamSummary | undefined {
  const { upstream } = lookup;
  if (upstream.requests === 0) return undefined;
  let slowest: { host: string; seen: HostSeen } | undefined;
  for (const [host, seen] of upstream.hosts) {
    if (!slowest || seen.ms > slowest.seen.ms) slowest = { host, seen };
  }
  const round = Math.round;
  return {
    requests: upstream.requests,
    ms: round(upstream.ms),
    ...(upstream.timeouts > 0 && { timeouts: upstream.timeouts }),
    ...(slowest && {
      slowest: {
        host: slowest.host,
        ms: round(slowest.seen.ms),
        connectMs: round(slowest.seen.connectingMs),
        waitMs: round(slowest.seen.waitingMs),
        ...(slowest.seen.timeouts > 0 && { timeouts: slowest.seen.timeouts }),
        ...(slowest.seen.address && { address: slowest.seen.address }),
      },
    }),
  };
}

/** `signal` and the look-up's own together: whichever ends first ends the question. */
export function withLookupSignal(signal?: AbortSignal | null): AbortSignal | undefined {
  const lookup = storage.getStore();
  if (!lookup) return signal ?? undefined;
  return signal ? AbortSignal.any([signal, lookup.signal]) : lookup.signal;
}
