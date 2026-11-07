import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentLookup, newLookup, runLookup, upstreamSummary } from "./lookup";
import { providerFetch } from "./providerFetch";
import { ResolverRegistry, TOO_LONG } from "./registry";
import { SafeFetchError } from "./safe-fetch";
import type { ResolveResult, SiteAdapter } from "./types";

/*
 * A look-up is a chain of questions to other sites. These tests are about what the registry does around that chain: one chain for one address however many
 * ask at once, a deadline past which the look-up is a failure and the chain is cut off, and a log line that says where a slow one spent its time.
 */

const events: Record<string, unknown>[] = [];
const log = { info: (o: Record<string, unknown>) => void events.push(o) };
const ok = (resolver: string, next?: string): ResolveResult => ({
  status: "success",
  resolver,
  media: { stream: { url: "https://x/a.mp4", type: "mp4" }, ...(next ? { series: { season: 1, episode: 1, next: { season: 1, episode: 2, url: next } } } : {}) },
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const loopbackOnly = { isAllowedAddress: (ip: string) => ip === "127.0.0.1" };

let server: http.Server;
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
let base: string;
beforeEach(async () => {
  events.length = 0;
  handler = (_req, res) => res.writeHead(200, { "content-type": "text/plain" }).end("hi");
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("one look-up at a time for one address", () => {
  it("answers everyone who asks for an address while it is being looked up from the one chain, and from what is kept after", async () => {
    let asked = 0;
    const releases: Array<() => void> = [];
    const slow: SiteAdapter = {
      id: "slow",
      domains: [],
      resolve: async () => {
        asked += 1;
        await new Promise<void>((resolve) => releases.push(resolve));
        return ok("slow");
      },
    };
    const registry = new ResolverRegistry([], slow, log);
    const first = registry.resolve("https://a.example/1");
    const second = registry.resolve("https://a.example/1", false, true); // (even one that wants a fresh look: the one under way is as fresh as can be)
    const other = registry.resolve("https://a.example/2");
    await sleep(10);
    expect(asked).toBe(2); // the two addresses, not the three asks
    for (const release of releases) release();
    expect(await first).toMatchObject({ resolver: "slow" });
    expect(await second).toMatchObject({ resolver: "slow" });
    expect(await other).toMatchObject({ resolver: "slow" });
    expect(await registry.resolve("https://a.example/1")).toMatchObject({ resolver: "slow" });
    expect(asked).toBe(2);
    expect(events.filter((event) => event.domain === "a.example")).toHaveLength(2); // one line per chain, not per ask
  });
});

describe("the deadline of a look-up", () => {
  it("gives up a look-up that takes too long: a failure that says so, logged as TIMEOUT, and the chain's questions are cut off", async () => {
    let cutOff = false;
    const endless: SiteAdapter = {
      id: "endless",
      domains: [],
      resolve: () =>
        new Promise((resolve) => {
          const lookup = currentLookup();
          expect(lookup).toBeDefined();
          lookup!.signal.addEventListener("abort", () => {
            cutOff = true;
            resolve(ok("late"));
          });
        }),
    };
    const registry = new ResolverRegistry([], endless, log, Date.now, { deadlineMs: 40 });
    const started = Date.now();
    expect(await registry.resolve("https://a.example/1")).toEqual(TOO_LONG);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(cutOff).toBe(true);
    expect(events[0]).toMatchObject({ domain: "a.example", resolver: "endless", success: false, reason: "TIMEOUT" });
    // (An answer that came too late is not kept: the next ask is a new look.)
    await registry.resolve("https://a.example/1");
    expect(events).toHaveLength(2);
  });

  it("is not in the way of a look-up that answers in time, and ends the chain's signal once it has", async () => {
    let signal: AbortSignal | undefined;
    const quick: SiteAdapter = {
      id: "quick",
      domains: [],
      resolve: async () => {
        signal = currentLookup()?.signal;
        return ok("quick");
      },
    };
    const registry = new ResolverRegistry([], quick, log, Date.now, { deadlineMs: 40 });
    expect(await registry.resolve("https://a.example/1")).toMatchObject({ resolver: "quick" });
    expect(signal?.aborted).toBe(true); // (nothing of the chain is left to run on in the background)
    await sleep(60);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ success: true });
    expect(events[0]).not.toHaveProperty("reason");
  });
});

describe("where a look-up spent its time", () => {
  it("counts the questions asked through providerFetch against the look-up under way, by host, and the registry logs them", async () => {
    handler = (_req, res) => setTimeout(() => res.writeHead(200, { "content-type": "text/plain" }).end("hi"), 15);
    const get = providerFetch(loopbackOnly);
    const asking: SiteAdapter = {
      id: "asking",
      domains: [],
      resolve: async () => {
        await get(`${base}/one`);
        await get(`${base}/two?token=secret`);
        await get(`${base}/gone`).catch(() => {});
        return ok("asking");
      },
    };
    const registry = new ResolverRegistry([], asking, log);
    await registry.resolve("https://a.example/1");
    const upstream = events[0]!.upstream as { requests: number; ms: number; slowest: { host: string; ms: number } };
    expect(upstream.requests).toBe(3);
    expect(upstream.ms).toBeGreaterThanOrEqual(30);
    expect(upstream.slowest).toEqual({ host: "127.0.0.1", ms: upstream.ms });
    expect(JSON.stringify(events)).not.toMatch(/secret|\/one|\/two/);
  });

  it("counts nothing outside a look-up, and logs no `upstream` for a look-up that asked nobody", async () => {
    await providerFetch(loopbackOnly)(`${base}/a`);
    const lookup = newLookup(new AbortController().signal);
    expect(upstreamSummary(lookup)).toBeUndefined();
    await runLookup(lookup, async () => {
      await providerFetch(loopbackOnly)(`${base}/a`);
    });
    expect(upstreamSummary(lookup)).toMatchObject({ requests: 1 });
    const registry = new ResolverRegistry([], { id: "g", resolve: async () => ok("g") }, log);
    await registry.resolve("https://a.example/1");
    expect(events[0]).not.toHaveProperty("upstream");
  });

  it("ends a question asked through providerFetch when the look-up it is part of ends", async () => {
    handler = () => {}; // (never answers)
    const control = new AbortController();
    const lookup = newLookup(control.signal);
    const question = runLookup(lookup, () => providerFetch(loopbackOnly)(`${base}/never`));
    setTimeout(() => control.abort(), 20);
    const error = (await question.then(() => null, (e: unknown) => e)) as SafeFetchError;
    expect(error).toBeInstanceOf(SafeFetchError);
    expect(error.code).toBe("timeout");
  });
});

describe("the look-up made ahead for the next episode", () => {
  it("is made a while after the episode was found, once, and logged as a prefetch", async () => {
    const asked: string[] = [];
    const series: SiteAdapter = {
      id: "series",
      domains: [],
      resolve: async (url) => {
        asked.push(url.href);
        return ok("series", url.href.endsWith("/2") ? undefined : "https://a.example/2");
      },
    };
    const registry = new ResolverRegistry([], series, log, Date.now, { prefetchDelayMs: 30 });
    await registry.resolve("https://a.example/1");
    expect(asked).toEqual(["https://a.example/1"]);
    await sleep(15);
    expect(asked).toEqual(["https://a.example/1"]); // (not yet: the screen is fetching the first pieces of the film)
    await sleep(40);
    expect(asked).toEqual(["https://a.example/1", "https://a.example/2"]);
    expect(events[1]).toMatchObject({ domain: "a.example", success: true, prefetch: true });
    expect(events[0]).not.toHaveProperty("prefetch");
  });
});
