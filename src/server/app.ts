import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { isHttpUrl, LibraryKindSchema, LibrarySectionSchema, type Registration } from "../shared";
import type { GoogleConfig } from "./accounts/google";
import type { PasswordCost } from "./accounts/password";
import { accountRoutes, COOKIE, readCookie } from "./accounts/routes";
import { ScreenProofs, screenProfiles } from "./accounts/screens";
import type { AccountStore } from "./accounts/store";
import { chatReporter } from "./feedback/chatReport";
import { feedbackRoutes, FEEDBACK_TOKEN_MIN, teamGuard } from "./feedback/routes";
import { FeedbackStore, MemoryFeedbackBackend } from "./feedback/store";
import { answerUnroutable, fetchLimits, sameSiteGate, securityHeaders, type FetchesPerMinute } from "./guard";
import { createLibrary, type LibrarySource } from "./library/library";
import { playKeyOf, UnavailableStore } from "./library/unavailable";
import { MemoryPersistence } from "./accounts/persistence";
import { exemptHostsFrom, handleStreamProxy, type ProxyStats } from "./proxy";
import { isOwnPage, looksLikePage, requestForLog } from "./requestLog";
import { createResolver, type ResolveFn } from "./resolvers";
import { SegmentCache, type SegmentCacheOptions } from "./segmentCache";
import { Hub, type HubOptions } from "./websocket/hub";
import type { PairingStore } from "./sessions/pairings";
import { Registry } from "./sessions/registry";
import { countVisits, statsRoutes } from "./stats/routes";
import type { VisitCounter } from "./stats/visits";
import { subsyncRoutes, type SubsyncStats } from "./subsync/routes";
import { MemorySubsyncStore, type SubsyncStore } from "./subsync/store";
import { MemoryOfficialStore, Officials, type OfficialStore } from "./subtitles/official";
import { officialRoutes } from "./subtitles/officialRoutes";
import { trustedProxies, visitorOf } from "./trust";

export interface AppOptions {
  /** Accounts, profiles and what they watched. Without it the server has no sign-in and every screen just keeps its own history. The app closes it when it stops. */
  accounts?: AccountStore;
  /** Keeps the pairs of `registry` between restarts; without it a restart makes every phone and TV forget each other. The app writes what is left of it when it stops. */
  pairings?: PairingStore;
  /** Where all of that is kept ("Postgres", "a file", "memory only"): `/api/health` says so, which is how to tell whether a host keeps anything between restarts. */
  storage?: "postgres" | "file" | "memory";
  /** Where the subtitle timings that screens share are kept (memory, gone with the server, unless set): see `shared/subsync.ts`. */
  subsync?: SubsyncStore;
  /** Where the Kino Official subtitles are kept (memory, gone with the server, unless set): see `subtitles/official.ts`. */
  official?: OfficialStore;
  /** Tests: how an offer's file is fetched (else the server asks itself for the track's link). */
  officialFetch?: (track: string) => Promise<string | undefined>;
  /** Where the feedback people send from the profile is kept (memory, gone with the server, unless set): see `shared/reports.ts`. */
  feedback?: FeedbackStore;
  /** The team's token for reading and answering feedback (env FEEDBACK_ADMIN_TOKEN, at least 24 characters). Without it nobody can read what is sent. */
  feedbackAdminToken?: string;
  /** How many reports one address may send in ten minutes (6 unless set; env FEEDBACK_SENDS_PER_10_MIN). */
  feedbackSendsPer10Min?: number;
  /** Counts the people who open the site, a number for each day (see `stats/visits.ts`); the owner reads it at `/api/admin/stats`. Without it nobody is counted. The app writes what is left of it when it stops. */
  visits?: VisitCounter;
  /** What nobody could play (see `library/unavailable.ts`): the screens mark it, the team reads it at `/api/admin/unavailable`. Memory, gone with the server, unless set. The app writes what is left of it when it stops. */
  unavailable?: UnavailableStore;
  /** `closed` stops new accounts being made. */
  registration?: Registration;
  maxAccounts?: number;
  /** How many accounts one address may make in an hour (10 unless set). */
  signUpsPerHour?: number;
  /** How many proxies sit in front of the server (a host like Render has one), so a visitor's address and https are read from the right place (Cloudflare's addresses are passed over on the way: `trust.ts`). */
  trustProxy?: boolean | number;
  /** Tests use a cheaper password hash. */
  passwordCost?: PasswordCost;
  /** Signing in with Google (env GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URIS: see accounts/google.ts and docs/google-sign-in.md). Off unless set. */
  google?: GoogleConfig;
  /** Built Vite app. Served at / and /tv. Omitted in tests/dev where Vite serves the UI. */
  clientDir?: string;
  /** Local test media served at /fixtures/. */
  fixturesDir?: string;
  registry?: Registry;
  /** URL -> media. Defaults to the real registry (adapters, then generic). Tests inject fakes. */
  resolve?: ResolveFn;
  /** Where the library's titles come from. None by default, so nothing here reaches the network unless asked. */
  librarySources?: LibrarySource[];
  /** The clock the library keeps its time by; tests move it. */
  libraryNow?: () => number;
  /** Let the resolver fetch loopback/LAN pages (local fixtures). Default false; env ALLOW_PRIVATE_NETWORK=1. */
  allowPrivateNetwork?: boolean;
  /** Whether `/api/proxy` carries film (playlists, pieces, files) or only subtitles. On unless set; env PROXY_VIDEO=off turns it off (see `ProxyOptions.video`). */
  proxyVideo?: boolean;
  /** The hosts whose film `/api/proxy` carries although it carries no film (see `ProxyOptions.exemptHosts`). None unless set; env PROXY_EXEMPT_HOSTS. */
  proxyExemptHosts?: readonly string[];
  /** How many times an address may ask in a minute for what makes the server fetch from another site: 60 for `/api/resolve`, 120 for the library's questions about a title, 60 for its search, 300 for `/api/proxy` while it carries no film (see `FetchesPerMinute`). Tests use small ones. */
  fetchesPerMinute?: FetchesPerMinute;
  /** How many of the library's searches may be under way at once, for one address and in all (3 and 32 unless set; see the search's route). */
  searchesAtOnce?: { perAddress?: number; inAll?: number };
  /** Whether screens may offer the cat companion. Off unless set; env CAT_COMPANION=on turns it on, and taking it back off is the kill switch (see `/api/features`). */
  cat?: boolean;
  /** Socket liveness tuning; tests shorten it. */
  hub?: HubOptions;
  /** How much of a film the proxy keeps for the screens of a party (64 MB, 3 minutes unless set; env SEGMENT_CACHE_MB sets the size in megabytes). */
  segmentCache?: SegmentCacheOptions;
  /** Fastify's log of each request (a test reads it by giving a stream of its own). */
  logger?: boolean | { level?: string; stream: { write(line: string): void } };
}

/** The size of the cache of film pieces from the environment (megabytes, a fraction will do), or nothing when it is not set to a number above zero. */
function segmentCacheFromEnv(): SegmentCacheOptions {
  const megabytes = Number(process.env.SEGMENT_CACHE_MB);
  return Number.isFinite(megabytes) && megabytes > 0 ? { maxBytes: Math.round(megabytes * 1024 * 1024) } : {};
}

/** Whether an `If-None-Match` header names `tag` (a weak comparison, so `W/` makes no difference) or anything at all (`*`). */
export function hasTag(header: string | undefined, tag: string): boolean {
  if (!header) return false;
  const bare = (value: string) => value.trim().replace(/^W\//, "");
  return header.split(",").some((each) => each.trim() === "*" || bare(each) === bare(tag));
}

const root = path.resolve(import.meta.dirname, "../..");

export function defaultClientDir(): string {
  return process.env.CLIENT_DIR ?? path.join(root, "dist/client");
}
export function defaultFixturesDir(): string {
  return process.env.FIXTURES_DIR ?? path.join(root, "fixtures");
}
/** Whether this is a deployed server (Render sets `RENDER`, and `NODE_ENV=production` says it too) and not a machine that runs the app for its owner or for its tests. */
export function isDeployed(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RENDER) || env.NODE_ENV === "production";
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  // A number is "this many proxies in front of me" (Fastify no longer reads a bare number as that, so spell it out), and zero is none. Cloudflare's
  // addresses and the host's own are not taken for the visitor's on the way (trust.ts).
  const proxies = options.trustProxy;
  const trustProxy = typeof proxies === "number" ? (proxies > 0 ? trustedProxies(proxies) : false) : proxies;
  // (What the log says about a request: the route and the names of its questions, not the link, the code or the visitor. See requestLog.ts.)
  const logger = options.logger === true ? { serializers: { req: requestForLog } } : options.logger ? { ...options.logger, serializers: { req: requestForLog } } : false;
  const app = Fastify({ logger, frameworkErrors: answerUnroutable, ...(trustProxy === undefined ? {} : { trustProxy }) });
  // (First of all: a hook added to the app reaches only what is registered after it, and the pages are served by what comes below.)
  // A visitor is one network of 64 bits, not one address, in every limit and count that goes by `request.ip` (trust.ts).
  app.addHook("onRequest", async (request) => {
    const visitor = visitorOf(request.ip);
    if (visitor !== request.ip) Object.defineProperty(request, "ip", { value: visitor });
  });
  // A request that was refused is written with the visitor it was refused to: the one place the log names one (requestLog.ts).
  app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode === 403 || reply.statusCode === 429) request.log.info({ status: reply.statusCode, visitor: request.ip }, "refused");
  });
  if (options.visits) countVisits(app, options.visits);
  securityHeaders(app);
  sameSiteGate(app);
  await app.register(fastifyCompress, {
    threshold: 1024,
  });
  const registry = options.registry ?? new Registry();
  const accounts = options.accounts;
  // (A screen that is signed in tells the watch party whose it is by a proof the accounts give it: see accounts/screens.ts.)
  const screens = accounts && new ScreenProofs(() => accounts.clock());
  if (accounts) {
    app.addHook("onClose", async () => accounts.close());
    await app.register(accountRoutes, {
      store: accounts,
      ...(options.registration ? { registration: options.registration } : {}),
      ...(options.maxAccounts ? { maxAccounts: options.maxAccounts } : {}),
      ...(options.signUpsPerHour ? { signUpsPerHour: options.signUpsPerHour } : {}),
      ...(options.passwordCost ? { passwordCost: options.passwordCost } : {}),
      ...(options.google ? { google: options.google } : {}),
      ...(screens ? { screens } : {}),
      // (A chat reported by one of the two friends goes to the team as feedback does. The store is made below, after the accounts: it is looked at when a report is sent.)
      chatReport: (report) => chatReporter(feedback)(report),
      // (What friends are invited to: the party a code is open with, and the code that party is joined with now, for a friend who was invited to it.)
      parties: {
        partyOf: (code) => registry.partyOfCode(code),
        running: (host, party, profileId) => registry.invitedParty(host, party, profileId) ?? undefined,
      },
    });
  }
  if (options.visits) {
    // (After the accounts', so it runs before it: the counts are written before the accounts close the database they share.)
    const visits = options.visits;
    app.addHook("onClose", async () => visits.close());
  }
  const resolve =
    options.resolve ??
    createResolver({
      log: app.log,
      allowPrivateNetwork: options.allowPrivateNetwork ?? process.env.ALLOW_PRIVATE_NETWORK === "1",
    });
  const library = createLibrary({ sources: options.librarySources ?? [], log: app.log, ...(options.libraryNow ? { now: options.libraryNow } : {}) });
  // (Registered after the accounts' close, so it runs before it: what is left is written before the accounts close the database they share.)
  const unavailable = options.unavailable ?? (await UnavailableStore.open({ persistence: new MemoryPersistence(), flushMs: 0 }));
  app.addHook("onClose", async () => unavailable.close());
  // Every try at playing something (from a phone or the TV: the look-up ahead of the next episode is the resolver's own, and does not come here) tells the library how it went, so the titles a place lists but has no video of stop being offered, and what no source had
  // is kept for the screens to mark and for the team to look for (it is asked about before the library hears it: a title that would not play is no longer one it tells).
  // The Kino Official subtitles (subtitles/official.ts): a title that has one is sent it first of its language, and the subtitle sites' tracks it is sent
  // are remembered, as the ones a screen may offer its timing of.
  const officials = await Officials.open({ store: options.official ?? new MemoryOfficialStore(), log: app.log });
  const resolveForPlay: ResolveFn = async (url, isPrefetch, fresh) => {
    const result = await resolve(url, isPrefetch, fresh);
    const play = result.status === "success" || result.status === "unsupported" ? playKeyOf(url) : null;
    const known = play ? library.known(play.titleId) : undefined;
    const about = known ? { title: known.title, kind: known.kind } : undefined;
    if (result.status === "success") unavailable.found(url);
    else if (result.status === "unsupported") unavailable.nothingFound(url, about);
    if (result.status === "success") library.played(url, "found");
    else if (result.status === "unsupported") library.played(url, "none");
    else if (result.status === "temporary_failure") library.played(url, "failed");
    if (result.status !== "success") return result;
    officials.heard(url, result, about);
    return officials.withOfficial(url, result);
  };
  const hub = new Hub(registry, resolveForPlay, { log: app.log, ...options.hub, ...(accounts && screens ? { profiles: screenProfiles(accounts, screens) } : {}) });
  // Hooks run last-registered first: the pairs are written before the accounts close the database they share.
  if (options.pairings) {
    const pairings = options.pairings;
    app.addHook("onClose", async () => pairings.close());
  }
  app.addHook("onClose", async () => hub.dispose());

  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
  // (No HEAD twin of the route: Fastify would call the handler with no socket.)
  app.get("/ws", { websocket: true, exposeHeadRoute: false }, (socket, request) => {
    // Connection diagnostics (no tokens/ids): who is knocking, via which host, and how it ends.
    const { host, origin } = request.headers;
    request.log.info({ host, origin }, "ws connected");
    socket.on("close", (code, reason) => request.log.info({ code, reason: reason.toString() }, "ws closed"));
    hub.handleConnection(socket, request.ip);
  });
  // Screens watching a film together ask for the same pieces of it: the proxy fetches each once and shares it (see `SegmentCache`).
  const segments = new SegmentCache(options.segmentCache ?? segmentCacheFromEnv());
  const proxyStats: ProxyStats = { bytes: 0, requests: 0, refused: 0 };
  const subsyncStats: SubsyncStats = { found: 0, missed: 0, stored: 0 };
  subsyncRoutes(app, { store: options.subsync ?? new MemorySubsyncStore(), stats: subsyncStats });
  officialRoutes(app, {
    officials,
    adminToken: options.feedbackAdminToken,
    // (The file as a screen got it: the server's own answer for the track's link, which is the Romanian sites' file it keeps or OpenSubtitles' through the proxy.)
    fetchFile:
      options.officialFetch ??
      (async (track) => {
        const answer = await app.inject({ method: "GET", url: track });
        return answer.statusCode === 200 ? answer.body : undefined;
      }),
  });
  const feedback = options.feedback ?? (await FeedbackStore.open({ backend: new MemoryFeedbackBackend() }));
  app.addHook("onClose", async () => feedback.close());
  await app.register(feedbackRoutes, {
    store: feedback,
    adminToken: options.feedbackAdminToken,
    sendsPer10Min: options.feedbackSendsPer10Min,
    // (A report sent while signed in is on all of the account's devices.)
    ...(accounts
      ? {
          accountOf: (request: FastifyRequest) => {
            const token = readCookie(request.headers.cookie, COOKIE);
            return token ? accounts.getSession(token)?.accountId : undefined;
          },
        }
      : {}),
  });
  // (The owner reads the stats with the same token as the feedback.)
  await app.register(statsRoutes, {
    adminToken: options.feedbackAdminToken,
    accounts,
    visits: options.visits,
    unavailable,
    registration: options.registration,
    maxAccounts: options.maxAccounts,
  });
  const isProxyOff = process.env.PROXY_VIDEO === "off" || process.env.PROXY_VIDEO === "false" || process.env.PROXY_VIDEO === "0";
  const proxyVideo = options.proxyVideo ?? !isProxyOff;
  const proxyExemptHosts = options.proxyExemptHosts ?? exemptHostsFrom(process.env.PROXY_EXEMPT_HOSTS);
  if (!proxyVideo && proxyExemptHosts.length > 0) app.log.info(`The proxy carries no film, except from: ${proxyExemptHosts.join(", ")}.`);
  // (After the gate at the top, so a request that is turned away for where it comes from is not counted against the visitor it was sent from, and before the routes it counts.)
  fetchLimits(app, options.fetchesPerMinute ?? {}, { video: proxyVideo });
  // The cat companion is shown to nobody until the host says so; a screen asks here whether it may offer one (and its settings switch is hidden when it may not).
  // Setting CAT_COMPANION back to off is the kill switch: every screen's cat is gone at its next load.
  const catOn = options.cat ?? /^(1|on|true|yes)$/i.test(process.env.CAT_COMPANION ?? "");
  app.get("/api/features", async (_request, reply) => reply.header("Cache-Control", "no-store").send({ cat: catOn }));
  // (`uptime`, in seconds, tells a server that was only just started - it slept, or was restarted - from one that has been up all along.
  // `segments` counts the asks for a piece of a film that the proxy answered itself (`hits`) and the ones it had to take to the film's own place
  // (`misses`): with screens watching together, the hits are the share of the load that was not multiplied by the number of screens.)
  // Anyone may ask whether the server is up (an uptime monitor, the box's update script, the debug panel): `ok`, `uptime` and `storage`. The
  // counters below are the team's, asked with its token as a Bearer (the judge's #12 and the owner's yes, 16 Nov): what the proxy carried, the
  // reports and whether a new one would be turned away, and so on told anyone how the site was used and when its feedback box was full. A
  // request that brings a wrong token gets the team guard's 401 (slowed per address), not the short answer, so a mistyped token is noticed.
  // (A server with no team token has no team's side: there, any request gets the short answer.)
  const teamOnly = teamGuard(options.feedbackAdminToken);
  const hasTeam = (options.feedbackAdminToken?.length ?? 0) >= FEEDBACK_TOKEN_MIN;
  app.get("/api/health", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const summary = { ok: true, ...(options.storage ? { storage: options.storage } : {}), uptime: Math.round(process.uptime()) };
    if (!request.headers.authorization || !hasTeam) return summary;
    if (!teamOnly(request, reply)) return;
    return { ...summary, ...healthCounters() };
  });
  const healthCounters = () => ({
    segments: { hits: segments.hits, misses: segments.misses, keptMB: Math.round(segments.keptBytes / 1024 / 1024) },
    // (`proxy` is what the proxy has sent on to the screens, in bytes: the films are most of what a host's bandwidth goes on, and this is how much that was.
    // `video` says whether it carries films at all, and `refused` how many asks it turned away because it does not.)
    proxy: { bytes: proxyStats.bytes, requests: proxyStats.requests, refused: proxyStats.refused, video: proxyVideo ? "on" : "off" },
    // (`subsync` counts the asks for a shared subtitle timing that found one and the ones that did not, and the timings screens have left.)
    subsync: subsyncStats,
    // (`official` is how many Kino Official subtitles are kept, and what became of the offers screens made since the server started.)
    official: { kept: officials.size, offers: officials.counts },
    // (`feedback` is how many reports are kept, whether the team can read them, and whether a new report would be turned away: `team` is false while
    // FEEDBACK_ADMIN_TOKEN is not set to 24 characters or more, and `full` is true while the reports that are still open take every place or all the room.)
    feedback: { reports: feedback.size, full: feedback.full, team: (options.feedbackAdminToken?.length ?? 0) >= FEEDBACK_TOKEN_MIN },
    features: { cat: catOn },
  });
  app.get("/api/library", async (request, reply) => {
    const body = JSON.stringify(await library.get());
    // The browser may keep the list for five minutes without asking; after that it asks with the tag of the one it has, and the list is
    // collected again only every few hours, so the answer is nearly always "the same" in a few bytes instead of the list in some dozens of kilobytes.
    const tag = `W/"${createHash("sha1").update(body).digest("base64url")}"`;
    reply.header("Cache-Control", "public, max-age=300").header("ETag", tag);
    if (hasTag(request.headers["if-none-match"], tag)) return reply.code(304).send();
    return reply.type("application/json; charset=utf-8").send(body);
  });
  // A search asks every place that lists titles, a few guesses at a slip, and checks what they find for video: some tens of fetches. A page has one under way at
  // a time (the one before is let go of as letters are typed, though here it runs to its end); an address may have a few at once and everyone together some tens.
  // Past either, a 429 like the minute's limit, and the page asks again in a moment.
  const searching = new Map<string, number>();
  let searchingInAll = 0;
  const { perAddress: searchesPerAddress = 3, inAll: searchesInAll = 32 } = options.searchesAtOnce ?? {};
  app.get<{ Querystring: { q?: string } }>("/api/library/search", async (request, reply) => {
    const q = request.query.q ?? "";
    // (A name given twice reaches a handler as a list.)
    if (typeof q !== "string") return reply.code(400).send({ error: "Bad 'q' parameter" });
    const mine = searching.get(request.ip) ?? 0;
    if (mine >= searchesPerAddress || searchingInAll >= searchesInAll) return reply.header("Retry-After", 2).code(429).send({ error: "rate_limited", retryAfter: 2 });
    searching.set(request.ip, mine + 1);
    searchingInAll += 1;
    let found: Awaited<ReturnType<typeof library.search>>;
    try {
      found = await library.search(q);
    } finally {
      searchingInAll -= 1;
      const left = (searching.get(request.ip) ?? 1) - 1;
      if (left > 0) searching.set(request.ip, left);
      else searching.delete(request.ip);
    }
    const { items, exact } = found;
    const topItem = items[0];
    if (topItem?.url && process.env.PRELOAD_SEARCH !== "0" && isHttpUrl(topItem.url)) {
      const timer = setTimeout(() => {
        resolve(topItem.url, true).catch(() => {});
      }, 200);
      timer.unref?.();
    }
    return reply.send({ items, exact });
  });
  // The rest of the library for a page that is scrolled: the next few rows (`cursor` is where the last answer said to go on from), and the next
  // twenty titles of one row. A place that cannot be reached is a 502, so the page tries again later instead of taking it for the end.
  // (`section` is the page the rows are for: movie, series, cartoon or anime. `kind` is what a page that was loaded before the sections said, and
  // takes the first two; with both, the section is the answer.)
  app.get<{ Querystring: { cursor?: string; kind?: string; section?: string } }>("/api/library/rows", async (request, reply) => {
    const cursor = Number(request.query.cursor ?? 0);
    const { kind } = request.query;
    const section = LibrarySectionSchema.safeParse(request.query.section);
    const legacy = LibraryKindSchema.safeParse(kind);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > 100000 || (request.query.section !== undefined && !section.success) || (kind !== undefined && !legacy.success)) {
      return reply.code(400).send({ error: "Bad 'cursor', 'section' or 'kind' parameter" });
    }
    try {
      return reply.header("Cache-Control", "public, max-age=300").send(await library.rows(section.success ? section.data : legacy.success ? legacy.data : undefined, cursor));
    } catch {
      return reply.code(502).header("Cache-Control", "no-store").send({ error: "The library could not be reached" });
    }
  });
  app.get<{ Querystring: { row?: string; page?: string } }>("/api/library/more", async (request, reply) => {
    const row = request.query.row ?? "";
    const page = Number(request.query.page);
    // (A name given twice reaches a handler as a list.)
    if (typeof row !== "string" || !row || row.length > 100 || !Number.isInteger(page) || page < 2 || page > 100) return reply.code(400).send({ error: "Missing 'row' or 'page' parameter" });
    try {
      return reply.header("Cache-Control", "public, max-age=300").send(await library.more(row, page));
    } catch {
      return reply.code(502).header("Cache-Control", "no-store").send({ error: "The library could not be reached" });
    }
  });
  app.get<{ Querystring: { url?: string } }>("/api/library/similar", async (request, reply) => {
    const link = request.query.url ?? "";
    if (typeof link !== "string" || !link || link.length > 2048) return reply.code(400).send({ error: "Missing 'url' parameter" });
    const items = await library.similar(link);
    // Only an answer is kept by the browser: none may be a place that could not be reached just now.
    reply.header("Cache-Control", items.length > 0 ? "public, max-age=3600" : "no-store");
    return reply.send({ items });
  });
  // What the movie database knows of a title besides its tile, asked for when its page is opened: one question for each title, kept for as long as the
  // library is. A title nobody knows (and a place that could not be reached just now) is `about: null`, which a browser is asked not to keep.
  app.get<{ Querystring: { url?: string } }>("/api/library/about", async (request, reply) => {
    const link = request.query.url ?? "";
    if (typeof link !== "string" || !link || link.length > 2048) return reply.code(400).send({ error: "Missing 'url' parameter" });
    const about = await library.about(link);
    reply.header("Cache-Control", about ? "public, max-age=3600" : "no-store");
    return reply.send({ about });
  });
  // One title by its id, for a link to its page (`/tv?title=movie-603`) opened by someone whose library has not met it yet. None for a title nobody knows; a place
  // that could not be reached just now is a 502, which the page treats as no title (and a browser is asked not to keep).
  app.get<{ Querystring: { id?: string } }>("/api/library/title", async (request, reply) => {
    const id = request.query.id ?? "";
    if (typeof id !== "string" || !/^[a-z0-9-]{3,80}$/.test(id)) return reply.code(400).send({ error: "Missing 'id' parameter" });
    try {
      const item = await library.title(id);
      return reply.header("Cache-Control", item ? "public, max-age=3600" : "no-store").send({ item });
    } catch {
      return reply.code(502).header("Cache-Control", "no-store").send({ error: "The library could not be reached" });
    }
  });
  app.get<{ Querystring: { url?: string; season?: string } }>("/api/library/episodes", async (request, reply) => {
    const link = request.query.url ?? "";
    const season = Number(request.query.season);
    if (typeof link !== "string" || !link || link.length > 2048 || !Number.isInteger(season) || season < 0 || season > 200) return reply.code(400).send({ error: "Missing 'url' or 'season' parameter" });
    const targetLink = !link.includes("?") && !link.includes("type=movie") ? `${link}?type=series&s=${season}&e=1` : link;
    const episodes = await library.episodes(targetLink, season);
    reply.header("Cache-Control", episodes.length > 0 ? "public, max-age=3600" : "no-store");
    return reply.send({ episodes });
  });
  // What no source had of the title a link plays (see `library/unavailable.ts`): the film, or the show's episodes. Never kept by a browser: it changes as titles are played.
  app.get<{ Querystring: { url?: string } }>("/api/library/unavailable", async (request, reply) => {
    const link = request.query.url ?? "";
    if (typeof link !== "string" || !link || link.length > 2048) return reply.code(400).send({ error: "Missing 'url' parameter" });
    return reply.header("Cache-Control", "no-store").send(unavailable.answerFor(link));
  });
  app.get<{ Querystring: { url?: string } }>("/api/library/seasons", async (request, reply) => {
    const link = request.query.url ?? "";
    if (typeof link !== "string" || !link || link.length > 2048) return reply.code(400).send({ error: "Missing 'url' parameter" });
    const targetLink = !link.includes("?") && !link.includes("type=movie") ? `${link}?type=series` : link;
    const seasons = await library.seasons(targetLink);
    // Only an answer is kept by the browser: no seasons may be a place that could not be reached just now.
    reply.header("Cache-Control", seasons.length > 0 ? "public, max-age=3600" : "no-store");
    return reply.send({ seasons });
  });
  app.get<{ Querystring: { url?: string } }>("/api/resolve", async (request, reply) => {
    const rawUrl = request.query.url;
    // (A name given twice reaches a handler as a list.)
    if (typeof rawUrl !== "string" || !rawUrl) return reply.code(400).send({ error: "Missing 'url' parameter" });
    const result = await resolve(rawUrl);
    return reply.send(result);
  });
  app.get<{ Params: { file: string } }>("/api/subtitles/ro/:file", async (request, reply) => {
    const file = request.params.file || "";
    const subId = file.replace(/\.vtt$/i, "");
    const { getRomanianSubtitleManager } = await import("./subtitles/romanian");
    const vtt = getRomanianSubtitleManager().getVtt(subId);
    if (!vtt) return reply.code(404).send({ error: "Subtitle not found" });
    reply.header("Content-Type", "text/vtt; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("Access-Control-Allow-Origin", "*");
    return reply.code(200).send(vtt);
  });
  app.get<{ Params: { file: string } }>("/api/subtitles/fallback/:file", async (request, reply) => {
    const file = request.params.file || "";
    const subId = file.replace(/\.vtt$/i, "");
    const { getFallbackSubtitleManager } = await import("./subtitles/fallbackSubtitles");
    const vtt = getFallbackSubtitleManager().getVtt(subId);
    if (!vtt) return reply.code(404).send({ error: "Subtitle not found" });
    reply.header("Content-Type", "text/vtt; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("Access-Control-Allow-Origin", "*");
    return reply.code(200).send(vtt);
  });
  app.get<{ Querystring: { url?: string; referer?: string } }>("/api/proxy", { compress: false }, async (request, reply) => {
    return handleStreamProxy(request, reply, {
      allowPrivateNetwork: options.allowPrivateNetwork ?? process.env.ALLOW_PRIVATE_NETWORK === "1",
      video: proxyVideo,
      exemptHosts: proxyExemptHosts,
      segments,
      stats: proxyStats,
    });
  });

  const fixturesDir = options.fixturesDir;
  if (fixturesDir && existsSync(fixturesDir)) {
    // (A file whose name starts with a dot, or that is in a folder whose name does, is served from neither folder, as `CLIENT_DIR` and `FIXTURES_DIR` may point at one with an `.env` in it.)
    await app.register(fastifyStatic, { root: fixturesDir, prefix: "/fixtures/", decorateReply: false, dotfiles: "ignore" });
  }

  const clientDir = options.clientDir && path.resolve(options.clientDir);
  if (clientDir && existsSync(path.join(clientDir, "index.html"))) {
    const assetsDir = path.join(clientDir, "assets") + path.sep;
    const alignerDir = path.join(clientDir, "subtitle-sync") + path.sep;
    await app.register(fastifyStatic, {
      root: clientDir,
      prefix: "/",
      dotfiles: "ignore",
      // Vite names the files in /assets after what is in them, so a changed file has a new name and an old one can be kept for good.
      // The subtitle aligner's model and worker are the same: a changed one goes in a new numbered folder (public/subtitle-sync/1/README.md).
      // The page itself is always checked again, which is how a new build reaches a screen that still has the old one.
      setHeaders: (reply, filePath) => {
        if (filePath.startsWith(assetsDir) || filePath.startsWith(alignerDir)) {
          reply.header("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.endsWith("index.html")) {
          reply.header("Cache-Control", "no-cache, must-revalidate");
        } else {
          reply.header("Cache-Control", "public, max-age=86400");
        }
      },
    });
    // Kino Labs' upscaler test is a page of its own (labs/upscale/index.html): without the last slash its address would be taken for one of the app's.
    if (existsSync(path.join(clientDir, "labs", "upscale", "index.html"))) {
      app.get("/labs/upscale", (_request, reply) => reply.redirect("/labs/upscale/", 301));
    }
    // One SPA: "/" is the phone, "/tv" is the receiver. Both are index.html.
    app.setNotFoundHandler((request, reply) => {
      // (HEAD too: a check that the page is there, as an uptime monitor makes, got a 404 for "/tv" while "/" answered. Node sends no body for it.)
      const isPage = (request.method === "GET" || request.method === "HEAD") && !request.url.startsWith("/api") && !request.url.startsWith("/ws");
      // (Not for what is no page of this site, a file or a place a scanner looks for: see `looksLikePage`. The site's own two pages answer whatever the request accepts.)
      if (isPage && (isOwnPage(request.url) || (looksLikePage(request.url) && request.headers.accept?.includes("text/html")))) {
        // Any other address that looks like a page gets the page too, which says there is no such page and opens the library (client/shared/strayAddress.ts),
        // but with a 404: it is not a page of the site (the judge, 16 Nov).
        if (!isOwnPage(request.url)) reply.code(404);
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "NOT_FOUND" });
    });
  }
  return app;
}
