import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { AnimeHintSchema, isHttpUrl, isNameLanguage, LibraryKindSchema, LibrarySectionSchema, NAME_ID, NAMES_AT_ONCE, type LibraryItem, type Registration } from "../shared";
import type { GoogleConfig } from "./accounts/google";
import { createAnimeSkipLookup, type AnimeSkipLookup } from "./anime/skipTimes";
import type { PasswordCost } from "./accounts/password";
import { accountRoutes, COOKIE, readCookie } from "./accounts/routes";
import { ScreenProofs, screenProfiles } from "./accounts/screens";
import type { AccountStore } from "./accounts/store";
import { chatReporter } from "./feedback/chatReport";
import { stickerAdminRoutes } from "./accounts/stickerRoutes";
import { feedbackRoutes, FEEDBACK_TOKEN_MIN, teamGuard } from "./feedback/routes";
import { FeedbackStore, MemoryFeedbackBackend } from "./feedback/store";
import { answerUnroutable, FETCHES_PER_DAY, fetchLimits, sameSiteGate, securityHeaders, type FetchesPerDay, type FetchesPerMinute } from "./guard";
import { createLibrary, type LibrarySource } from "./library/library";
import type { NameBook } from "./library/names";
import { keepOverRestart, RateLimiter } from "./accounts/rateLimit";
import { playKeyOf, UnavailableStore } from "./library/unavailable";
import { MemoryPersistence } from "./accounts/persistence";
import { exemptHostsFrom, handleStreamProxy, type ProxyStats } from "./proxy";
import { AppReleases, appReleaseRoutes } from "./push/appRelease";
import type { PushSender } from "./push/fcm";
import { PushHub } from "./push/push";
import type { TitleNoticeBook } from "./titleNotices/book";
import { isOwnPage, looksLikePage, requestForLog } from "./requestLog";
import { createResolver, type ResolveFn } from "./resolvers";
import { SegmentCache, type SegmentCacheOptions } from "./segmentCache";
import { Hub, type HubOptions } from "./websocket/hub";
import type { PairingStore } from "./sessions/pairings";
import { Registry } from "./sessions/registry";
import { LiveCount } from "./stats/live";
import { countLive, ownerStatsRoutes } from "./stats/owner";
import { countVisits, statsRoutes } from "./stats/routes";
import type { VisitCounter } from "./stats/visits";
import { subsyncRoutes, type SubsyncStats } from "./subsync/routes";
import { MemorySubsyncStore, type SubsyncStore } from "./subsync/store";
import { MemoryOfficialStore, Officials, type OfficialStore } from "./subtitles/official";
import { officialRoutes } from "./subtitles/officialRoutes";
import { trustedProxies, visitorOf } from "./trust";
import { watchedOnKino } from "./accounts/watching";

export interface AppOptions {
  accounts?: AccountStore;
  pairings?: PairingStore;
  storage?: "postgres" | "file" | "memory";
  subsync?: SubsyncStore;
  official?: OfficialStore;
  officialFetch?: (track: string) => Promise<string | undefined>;
  feedback?: FeedbackStore;
  feedbackAdminToken?: string;
  feedbackSendsPer10Min?: number;
  visits?: VisitCounter;
  ownerStatsToken?: string | undefined;
  ownerStatsOrigin?: string | undefined;
  unavailable?: UnavailableStore;
  registration?: Registration;
  maxAccounts?: number;
  signUpsPerHour?: number;
  signUpsPerDay?: number;
  syncWritesPerDay?: number;
  slowChecksPer15Min?: number;
  trustProxy?: boolean | number;
  passwordCost?: PasswordCost;
  google?: GoogleConfig;
  push?: PushSender;
  androidAppDir?: string;
  clientDir?: string;
  fixturesDir?: string;
  registry?: Registry;
  resolve?: ResolveFn;
  librarySources?: LibrarySource[];
  names?: NameBook;
  titleNotices?: TitleNoticeBook;
  nameLookupsPer10Min?: number;
  libraryNow?: () => number;
  allowPrivateNetwork?: boolean;
  proxyVideo?: boolean;
  proxyExemptHosts?: readonly string[];
  fetchesPerMinute?: FetchesPerMinute;
  fetchesPerDay?: Partial<FetchesPerDay>;
  searchesAtOnce?: { perAddress?: number; inAll?: number };
  klipyKey?: string;
  animeSkip?: AnimeSkipLookup | null;
  hub?: HubOptions;
  segmentCache?: SegmentCacheOptions;
  logger?: boolean | { level?: string; stream: { write(line: string): void } };
}

function segmentCacheFromEnv(): SegmentCacheOptions {
  const megabytes = Number(process.env.SEGMENT_CACHE_MB);
  return Number.isFinite(megabytes) && megabytes > 0 ? { maxBytes: Math.round(megabytes * 1024 * 1024) } : {};
}

export function hasTag(header: string | undefined, tag: string): boolean {
  if (!header) return false;
  const bare = (value: string) => value.trim().replace(/^W\//, "");
  return header.split(",").some((each) => each.trim() === "*" || bare(each) === bare(tag));
}

const root = path.resolve(import.meta.dirname, "../..");
const WATCHING_FRESH_MS = 15 * 60_000;

export function defaultClientDir(): string {
  return process.env.CLIENT_DIR ?? path.join(root, "dist/client");
}
export function defaultFixturesDir(): string {
  return process.env.FIXTURES_DIR ?? path.join(root, "fixtures");
}
export function isDeployed(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RENDER) || env.NODE_ENV === "production";
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const proxies = options.trustProxy;
  const trustProxy = typeof proxies === "number" ? (proxies > 0 ? trustedProxies(proxies) : false) : proxies;
  const logger = options.logger === true ? { serializers: { req: requestForLog } } : options.logger ? { ...options.logger, serializers: { req: requestForLog } } : false;
  const app = Fastify({ logger, frameworkErrors: answerUnroutable, ...(trustProxy === undefined ? {} : { trustProxy }) });
  app.addHook("onRequest", async (request) => {
    const visitor = visitorOf(request.ip);
    if (visitor !== request.ip) Object.defineProperty(request, "ip", { value: visitor });
  });
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
  const screens = accounts && new ScreenProofs(() => accounts.clock());
  if (accounts) {
    app.addHook("onClose", async () => accounts.close());
    await app.register(accountRoutes, {
      store: accounts,
      ...(options.registration ? { registration: options.registration } : {}),
      ...(options.maxAccounts ? { maxAccounts: options.maxAccounts } : {}),
      ...(options.signUpsPerHour ? { signUpsPerHour: options.signUpsPerHour } : {}),
      ...(options.signUpsPerDay ? { signUpsPerDay: options.signUpsPerDay } : {}),
      ...(options.syncWritesPerDay ? { syncWritesPerDay: options.syncWritesPerDay } : {}),
    ...(options.slowChecksPer15Min ? { slowChecksPer15Min: options.slowChecksPer15Min } : {}),
      ...(options.passwordCost ? { passwordCost: options.passwordCost } : {}),
      ...(options.google ? { google: options.google } : {}),
      ...(screens ? { screens } : {}),
      chatReport: (report) => chatReporter(feedback)(report),
      ...(options.titleNotices ? { titleNotices: options.titleNotices } : {}),
      parties: {
        partyOf: (code) => registry.partyOfCode(code),
        running: (host, party, profileId) => registry.invitedParty(host, party, profileId) ?? undefined,
      },
    });
  }
  if (options.visits) {
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
  const unavailable = options.unavailable ?? (await UnavailableStore.open({ persistence: new MemoryPersistence(), flushMs: 0 }));
  app.addHook("onClose", async () => unavailable.close());
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
  if (options.pairings) {
    const pairings = options.pairings;
    app.addHook("onClose", async () => pairings.close());
  }
  app.addHook("onClose", async () => hub.dispose());

  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
  app.get("/ws", { websocket: true, exposeHeadRoute: false }, (socket, request) => {
    const { host, origin } = request.headers;
    request.log.info({ host, origin }, "ws connected");
    socket.on("close", (code, reason) => request.log.info({ code, reason: reason.toString() }, "ws closed"));
    hub.handleConnection(socket, request.ip);
  });
  const segments = new SegmentCache(options.segmentCache ?? segmentCacheFromEnv());
  const proxyStats: ProxyStats = { bytes: 0, requests: 0, refused: 0 };
  const subsyncStats: SubsyncStats = { found: 0, missed: 0, stored: 0 };
  subsyncRoutes(app, { store: options.subsync ?? new MemorySubsyncStore(), stats: subsyncStats });
  officialRoutes(app, {
    officials,
    adminToken: options.feedbackAdminToken,
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
    ...(accounts
      ? {
          accountOf: (request: FastifyRequest) => {
            const token = readCookie(request.headers.cookie, COOKIE);
            return token ? accounts.getSession(token)?.accountId : undefined;
          },
        }
      : {}),
  });
  await app.register(statsRoutes, {
    adminToken: options.feedbackAdminToken,
    accounts,
    visits: options.visits,
    unavailable,
    registration: options.registration,
    maxAccounts: options.maxAccounts,
  });
  if (options.ownerStatsToken && options.ownerStatsToken.length >= FEEDBACK_TOKEN_MIN) {
    const live = new LiveCount();
    keepOverRestart("stats.hours", live);
    countLive(app, live);
    if (accounts && options.visits) accounts.onWatched((seconds) => options.visits?.watched(seconds));
    await app.register(ownerStatsRoutes, {
      token: options.ownerStatsToken,
      origin: options.ownerStatsOrigin,
      accounts,
      visits: options.visits,
      feedback,
      live,
      connected: () => hub.connected(),
      registration: options.registration,
      maxAccounts: options.maxAccounts,
    });
  }
  const isProxyOff = process.env.PROXY_VIDEO === "off" || process.env.PROXY_VIDEO === "false" || process.env.PROXY_VIDEO === "0";
  const proxyVideo = options.proxyVideo ?? !isProxyOff;
  const proxyExemptHosts = options.proxyExemptHosts ?? exemptHostsFrom(process.env.PROXY_EXEMPT_HOSTS);
  if (!proxyVideo && proxyExemptHosts.length > 0) app.log.info(`The proxy carries no film, except from: ${proxyExemptHosts.join(", ")}.`);
  fetchLimits(app, options.fetchesPerMinute ?? {}, { video: proxyVideo, perDay: { ...FETCHES_PER_DAY, ...options.fetchesPerDay } });
  const nameLookups = new RateLimiter(options.nameLookupsPer10Min ?? 2400, 10 * 60 * 1000);
  const animeSkip = options.animeSkip !== undefined ? options.animeSkip : /^(0|off|false|no)$/i.test(process.env.ANIME_SKIP ?? "") ? null : createAnimeSkipLookup();
  const klipyWritten = (options.klipyKey ?? process.env.KLIPY_KEY ?? "").trim();
  const klipyKey = /^[A-Za-z0-9_-]{8,200}$/.test(klipyWritten) ? klipyWritten : "";
  if (klipyWritten && !klipyKey) app.log.warn("KLIPY_KEY does not look like a KLIPY key: the chats have no GIFs.");
  const stickersOn = accounts?.stickers.on === true;
  const pushHub = accounts ? new PushHub(accounts, options.push, app.log) : undefined;
  if (options.titleNotices) {
    const titleNotices = options.titleNotices;
    titleNotices.onTell((profile) => void pushHub?.titleNotice(profile));
    app.addHook("onListen", async () => titleNotices.start());
    app.addHook("onClose", async () => titleNotices.close());
  }
  const releases = options.androidAppDir ? new AppReleases(options.androidAppDir, pushHub, app.log) : undefined;
  if (releases) {
    await releases.start();
    app.addHook("onListen", async () => releases.listening());
    app.addHook("onClose", async () => releases.stop());
  }
  appReleaseRoutes(app, releases);
  const pushOn = pushHub?.on === true;
  const movingOn = accounts?.stickers.moving === true;
  const features = {
    ...(klipyKey ? { gifs: klipyKey } : {}),
    ...(stickersOn ? { stickers: true } : {}),
    ...(movingOn ? { movingStickers: true } : {}),
    ...(pushOn ? { push: true } : {}),
  };
  if (accounts) stickerAdminRoutes(app, { stickers: accounts.stickers, adminToken: options.feedbackAdminToken });
  app.get("/api/features", async (_request, reply) => reply.header("Cache-Control", "no-store").send(features));
  const teamOnly = teamGuard(options.feedbackAdminToken, "team.site");
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
    proxy: { bytes: proxyStats.bytes, requests: proxyStats.requests, refused: proxyStats.refused, video: proxyVideo ? "on" : "off" },
    subsync: subsyncStats,
    official: { kept: officials.size, offers: officials.counts },
    feedback: { reports: feedback.size, full: feedback.full, team: (options.feedbackAdminToken?.length ?? 0) >= FEEDBACK_TOKEN_MIN },
    features: { ...(klipyKey ? { gifs: true } : {}), ...(stickersOn ? { stickers: true } : {}), ...(pushOn ? { push: true } : {}) },
    ...(accounts ? { stickers: accounts.stickers.size } : {}),
    ...(pushHub ? { push: { devices: accounts!.countPushDevices(), ...pushHub.counts, app: releases?.latest?.versionCode ?? 0 } } : {}),
  });
  app.get("/api/library", async (request, reply) => {
    const body = JSON.stringify(await library.get());
    const tag = `W/"${createHash("sha1").update(body).digest("base64url")}"`;
    reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600").header("ETag", tag);
    if (hasTag(request.headers["if-none-match"], tag)) return reply.code(304).send();
    return reply.type("application/json; charset=utf-8").send(body);
  });
  const searching = new Map<string, number>();
  let searchingInAll = 0;
  const { perAddress: searchesPerAddress = 3, inAll: searchesInAll = 32 } = options.searchesAtOnce ?? {};
  app.get<{ Querystring: { q?: string } }>("/api/library/search", async (request, reply) => {
    const q = request.query.q ?? "";
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
    if (typeof row !== "string" || !row || row.length > 100 || !Number.isInteger(page) || page < 2 || page > 100) return reply.code(400).send({ error: "Missing 'row' or 'page' parameter" });
    try {
      return reply.header("Cache-Control", "public, max-age=300").send(await library.more(row, page));
    } catch {
      return reply.code(502).header("Cache-Control", "no-store").send({ error: "The library could not be reached" });
    }
  });
  app.get<{ Querystring: { lang?: string; ids?: string } }>("/api/library/names", async (request, reply) => {
    const { lang, ids } = request.query;
    if (typeof lang !== "string" || !isNameLanguage(lang) || typeof ids !== "string" || ids.length > NAMES_AT_ONCE * 16) return reply.code(400).send({ error: "Bad 'lang' or 'ids' parameter" });
    const asked = [...new Set(ids.split(","))];
    if (asked.length === 0 || asked.length > NAMES_AT_ONCE || asked.some((id) => !NAME_ID.test(id))) return reply.code(400).send({ error: "Bad 'lang' or 'ids' parameter" });
    const book = options.names;
    if (!book) return reply.header("Cache-Control", "no-store").send({ names: {} });
    const names = await book.of(lang, asked, () => {
      if (nameLookups.wait(request.ip) > 0) return false;
      nameLookups.hit(request.ip);
      return true;
    });
    return reply.header("Cache-Control", Object.keys(names).length === asked.length ? "public, max-age=86400" : "no-store").send({ names });
  });
  app.get<{ Querystring: { url?: string } }>("/api/library/similar", async (request, reply) => {
    const link = request.query.url ?? "";
    if (typeof link !== "string" || !link || link.length > 2048) return reply.code(400).send({ error: "Missing 'url' parameter" });
    const items = await library.similar(link);
    reply.header("Cache-Control", items.length > 0 ? "public, max-age=3600" : "no-store");
    return reply.send({ items });
  });
  app.get<{ Querystring: { url?: string } }>("/api/library/about", async (request, reply) => {
    const link = request.query.url ?? "";
    if (typeof link !== "string" || !link || link.length > 2048) return reply.code(400).send({ error: "Missing 'url' parameter" });
    const about = await library.about(link);
    reply.header("Cache-Control", about ? "public, max-age=3600" : "no-store");
    return reply.send({ about });
  });
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
  let watching: { at: number; items: LibraryItem[] } | undefined;
  let working: Promise<void> | undefined;
  const workOutWatching = async () => {
    const at = Date.now();
    const ids = accounts ? watchedOnKino(accounts) : [];
    const items: LibraryItem[] = [];
    for (const id of ids) {
      const item = await library.title(id).catch(() => null);
      if (item) items.push(item);
    }
    watching = { at, items };
  };
  app.get("/api/watching", async (_request, reply) => {
    if (!watching || Date.now() - watching.at > WATCHING_FRESH_MS) {
      working ??= workOutWatching().finally(() => (working = undefined));
      await working;
    }
    return reply.header("Cache-Control", "public, max-age=600").send({ items: watching?.items ?? [] });
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
    reply.header("Cache-Control", seasons.length > 0 ? "public, max-age=3600" : "no-store");
    return reply.send({ seasons });
  });
  app.get<{ Querystring: { url?: string } }>("/api/resolve", async (request, reply) => {
    const rawUrl = request.query.url;
    if (typeof rawUrl !== "string" || !rawUrl) return reply.code(400).send({ error: "Missing 'url' parameter" });
    const result = await resolve(rawUrl);
    return reply.send(result);
  });
  app.get<{ Querystring: Record<string, string | string[] | undefined> }>("/api/anime/skip", async (request, reply) => {
    const { title, season, episode, length } = request.query;
    const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
    const hint = AnimeHintSchema.safeParse({ title: one(title)?.trim(), season: Number(one(season) ?? "1"), episode: Number(one(episode) ?? "1") });
    const seconds = Number(one(length));
    if (!hint.success || !Number.isFinite(seconds) || seconds < 60 || seconds > 14_400) return reply.code(400).send({ error: "Bad 'title', 'season', 'episode' or 'length' parameter" });
    const skip = animeSkip ? await animeSkip.find(hint.data, seconds) : null;
    return reply.header("Cache-Control", `private, max-age=${skip ? 3600 : 600}`).send({ skip });
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
      preCompressed: true,
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
    const indexFile = path.join(clientDir, "index.html");
    let served = { changed: -1, build: null as string | null };
    const buildNow = (): string | null => {
      try {
        const changed = statSync(indexFile).mtimeMs;
        if (changed !== served.changed) served = { changed, build: /\/assets\/(index-[\w-]+)\.js/.exec(readFileSync(indexFile, "utf8"))?.[1] ?? null };
        return served.build;
      } catch {
        return null;
      }
    };
    app.get("/api/build", async (_request, reply) => reply.header("Cache-Control", "no-store").send({ build: buildNow() }));
    app.setNotFoundHandler((request, reply) => {
      const isPage = (request.method === "GET" || request.method === "HEAD") && !request.url.startsWith("/api") && !request.url.startsWith("/ws");
      if (isPage && (isOwnPage(request.url) || (looksLikePage(request.url) && request.headers.accept?.includes("text/html")))) {
        if (!isOwnPage(request.url)) reply.code(404);
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "NOT_FOUND" });
    });
  }
  return app;
}
