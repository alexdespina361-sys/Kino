import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isAppStart } from "./accounts/google";
import { DayCount, RateLimiter } from "./accounts/rateLimit";

const MINUTE = 60_000;

/**
 * What no page of this site does: set another base address, embed a plugin, send a form elsewhere, be shown in a frame, or run a script that is not one of its own
 * files. `script-src 'self'` turns away a script written into a page (inline, or an `on...=` in markup) and one from another site, which is what a slip in the escaping
 * would be used for (the judge, 16 Nov: the header said nothing about scripts). It keeps `'unsafe-eval'`, as the subtitle aligner's WebAssembly needs it in the Chromium
 * 94 of a Hisense, which has no `'wasm-unsafe-eval'` yet (a newer browser takes that one for the same, and for the frame boost's runtime). There is no `default-src`:
 * the pictures, the sound and the videos come from many places. (The pages have no inline script; the workers are files of the site.)
 */
const BASELINE_POLICY = "base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'";

/**
 * What every answer tells the browser that gets it, whatever the route: not to guess a type for what it is sent (`nosniff`), to say nothing of the page a visitor came
 * from, not to be shown inside a page of another site, not to let a page ask for what nothing here uses (the microphone, the position, a payment, a USB device) and,
 * over https, to come only that way for a year (a host's proxy says it was https: `trust.ts`). The camera, full screen, the wake lock and the clipboard are left alone:
 * the code scanner and the player use them. It is the first hook, so a route that says one of these itself keeps its own (the proxy's answers carry their own
 * `Content-Security-Policy`, `default-src 'none'; sandbox`, which takes the place of the one here).
 */
export function securityHeaders(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    stampHeaders(request, reply);
  });
}

function stampHeaders(request: FastifyRequest, reply: FastifyReply): void {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Content-Security-Policy", BASELINE_POLICY);
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Permissions-Policy", "microphone=(), geolocation=(), payment=(), usb=()");
  // (A browser takes this from a page that came over https only, so it is not said to one that came over http.)
  if (request.protocol === "https") reply.header("Strict-Transport-Security", "max-age=31536000");
}

/**
 * What answers an address that cannot be read at all (`/%zz`, a part of the path too long to be a name): the router turns it away before any hook has run, so the hook
 * above never sees it and its answer would go out bare. This is given to Fastify as `frameworkErrors` and says the same words, then the answer Fastify would have given.
 * (The request it is handed is made before a host's proxy has been read, so behind one the `Strict-Transport-Security` of the other answers is not repeated here; a browser
 * keeps what they said.)
 */
export function answerUnroutable(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  stampHeaders(request, reply);
  void reply.send(error);
}

/** The library's routes that take the address of a title and ask the place that lists it, and the player's question about an anime episode's opening and credits (AniList, AniSkip). */
const TITLE_ASKS = ["/api/library/about", "/api/library/title", "/api/library/episodes", "/api/library/seasons", "/api/anime/skip"];

/**
 * What is like a title: asked by a title's page once, and by the rows a profile is given of its own ("Because you watched ...", shared/recommend.ts) many times as a
 * page is scrolled. Counted by itself, so that those rows on two or three screens at one address cannot use up what the page of a title needs for its own questions.
 */
const LIKE_ASKS = ["/api/library/similar"];

/** The library's routes that page through the shelves: more rows are asked for as a page is scrolled, and more titles of one row. Few answers are kept for as many as can be asked. */
const BROWSE_ASKS = ["/api/library/rows", "/api/library/more", "/api/library/names"];

/**
 * The routes that make this server fetch from another site for whoever asks (the library's, when what it keeps has gone out of date), and Google's way back from a
 * sign-in, which takes the code it brings to Google's token endpoint: Google sends the browser there from its own site, which is a navigation, and nothing else does.
 */
const FETCHES = new Set(["/api/proxy", "/api/resolve", "/api/library", "/api/library/search", ...BROWSE_ASKS, ...TITLE_ASKS, ...LIKE_ASKS, "/api/auth/google/callback"]);

/**
 * The routes that only read, but for the visitor whose session they are asked with, and count or note something against it: everything of a profile (the Friends page being open is how its
 * friends see it online, a chat being open is what has been seen in it, a tag or a code of an invitation that nobody has counts as a wrong guess, and each of them takes from the allowance of
 * reads), the lookup of the code of a link, and the visitor's own reports (which take from the address's allowance of reads). A link leads to none of them, so nothing but this site's own
 * pages may ask. (A route is told by the start of its path, so one that is added to these is covered at once.) The start of a sign-in with Google is one too: it is only ever this site's
 * own button, and each one keeps a flow and takes from the address's allowance of them; but the Android app's own trip (`isAppStart`) is let in as a navigation, as the
 * phone's browser the app opens it in says it comes from another site.
 */
const COUNTED_PREFIXES = ["/api/profiles/", "/api/link/"];
const COUNTED_ROUTES = new Set(["/api/feedback/mine", "/api/auth/google/start", "/api/auth/google/app-claim"]);
const counts = (route: string) => COUNTED_ROUTES.has(route) || COUNTED_PREFIXES.some((prefix) => route.startsWith(prefix));

/** Whether `origin`, as a browser writes it in `Origin` (an address without a path, or `null`), is the very host `host` (the `Host` header) names, with its port. */
export function isOwnOrigin(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    const from = new URL(origin);
    return from.host === new URL(`${from.protocol}//${host}`).host;
  } catch {
    return false;
  }
}

/**
 * Where a request to the api came from. A session is a cookie that goes along with every request from a page of the same *site*, which is every name under
 * `24-7.ro` and not only this one (`SameSite=Lax`), and several routes that change something need no body, so a page of a sibling name could send them with a
 * visitor's cookie. A request that is not a read is turned away (403 `cross_site`) when the browser says it comes from another site or another name of this one
 * (`Sec-Fetch-Site`), or brings an `Origin` that is not the host it was sent to: the host is compared with the `Host` header, so each address the site is served
 * at is its own origin and none is listed. A request with none of these headers (a script, curl, an old browser) is as it was. A browser that says the request is from
 * this very origin (`same-origin`: a page cannot set that word, nor change it) is believed over its `Origin`, which a browser writes as `null` when the page asked for
 * no referrer (`Referrer-Policy: no-referrer`, as every answer here says) and the request was not made in the CORS mode (a form, a beacon, a fetch kept to the origin).
 *
 * What only reads is let through, except what makes this server fetch for whoever asks (`FETCHES`): a page of another site must not be able to use the server
 * for that, so it is turned away on the same word of the browser, unless the visitor followed a link there (a navigation); and what counts or notes something against
 * the visitor's session (`COUNTED_PREFIXES`, `COUNTED_ROUTES`), which is turned away on that word whether or not a link led there.
 */
export function sameSiteGate(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    // (The path of the route that answers, not the one that was written: `/%61pi/...` reaches the same route.)
    const route = request.routeOptions.url ?? "";
    if (!route.startsWith("/api/") || request.method === "OPTIONS") return;
    const site = request.headers["sec-fetch-site"];
    const elsewhere = site === "cross-site" || site === "same-site";
    let refused: boolean;
    if (request.method === "GET" || request.method === "HEAD") {
      const navigation = request.headers["sec-fetch-mode"] === "navigate";
      // (The app's trip to Google, in the phone's browser: a page of its own, never a frame, nor one fetched ahead before anybody asked for it - each start keeps a flow and
      // takes from the address's allowance. The judge, 17 Nov.)
      const ahead = /prefetch|prerender/i.test(`${request.headers["sec-purpose"] ?? ""} ${request.headers.purpose ?? ""}`);
      const appTrip =
        route === "/api/auth/google/start" && navigation && !ahead && (request.headers["sec-fetch-dest"] ?? "document") === "document" && isAppStart((request.query ?? {}) as Record<string, unknown>);
      refused = elsewhere && !appTrip && (counts(route) || (FETCHES.has(route) && !navigation));
    } else {
      const { origin, host } = request.headers;
      refused = elsewhere || (site !== "same-origin" && origin !== undefined && !isOwnOrigin(origin, host));
    }
    if (refused) return reply.code(403).send({ error: "cross_site" });
  });
}

/** How many times an address may ask, in a minute, for what makes this server fetch from another site. Generous: a page asks a handful of times when a title is opened. */
export interface FetchesPerMinute {
  /** `/api/resolve` (60 unless set). */
  resolve?: number;
  /** The library's questions about one title (`about`, `title`, `episodes` and `seasons`, counted together; 120 unless set). */
  library?: number;
  /** What is like a title (`similar`, counted by itself; 120 unless set). */
  similar?: number;
  /** The library's search (60 unless set, counted by itself): one ask goes to the movie database, to the places that list titles and to a probe of each title found, and the page of the likeliest title is fetched ahead for the player. */
  search?: number;
  /** `/api/proxy`, while it carries no film (300 unless set). With film on, a player asks for one piece after another, and there is no limit here. */
  proxy?: number;
  /** The library's rows and the next titles of a row (`rows` and `more`, counted together; 300 unless set): a page that is scrolled asks a few times a minute, and what is not kept goes to the movie database. */
  browse?: number;
}

/**
 * ...and in a day (UTC), for the ones that are not the playing of a film (the look-up of a link and `/api/proxy` are left to their minute). A minute's
 * allowance all day long is tens of thousands of fetches from other sites by one address, under the site's one key of the movie database (the review
 * of 18 Nov). Far above what a household asks in a day; kept over a restart.
 */
export interface FetchesPerDay {
  /** The library's search. */
  search: number;
  /** The questions about a title and what is like a title, counted together. */
  titles: number;
  /** The rows and the next titles of a row. */
  browse: number;
}
export const FETCHES_PER_DAY: Readonly<FetchesPerDay> = { search: 3000, titles: 30_000, browse: 30_000 };

/**
 * Anyone may ask this server to go and fetch a page (`/api/resolve`, the library's questions about a title, the library's search, its rows and the titles of a row) or a text (`/api/proxy` without film, which is subtitles),
 * and each ask costs a fetch from another site and some of this host's bandwidth, so an address may make only so many of them in a minute: past it the answer is a 429
 * with `Retry-After`, as everywhere else, and nothing is fetched. The count is of the route that answers (a path written another way reaches the same route and the
 * same count), and a request that the gate above turned away is not counted: it must not use up the allowance of the visitor whose browser it was sent from. A restart forgives everyone.
 */
export function fetchLimits(
  app: FastifyInstance,
  { resolve = 60, library = 120, similar = 120, search = 60, proxy = 300, browse = 300 }: FetchesPerMinute,
  { video, perDay = FETCHES_PER_DAY }: { video: boolean; perDay?: FetchesPerDay },
): void {
  const days = new Map<string, DayCount>();
  days.set("/api/library/search", new DayCount(perDay.search, undefined, "fetch.searchPerDay"));
  const titlesToday = new DayCount(perDay.titles, undefined, "fetch.titlesPerDay");
  for (const route of [...TITLE_ASKS, ...LIKE_ASKS]) days.set(route, titlesToday);
  const browsedToday = new DayCount(perDay.browse, undefined, "fetch.browsePerDay");
  for (const route of BROWSE_ASKS) days.set(route, browsedToday);
  const limiters = new Map<string, RateLimiter>();
  limiters.set("/api/resolve", new RateLimiter(resolve, MINUTE));
  limiters.set("/api/library/search", new RateLimiter(search, MINUTE));
  const titles = new RateLimiter(library, MINUTE);
  for (const route of TITLE_ASKS) limiters.set(route, titles);
  const likes = new RateLimiter(similar, MINUTE);
  for (const route of LIKE_ASKS) limiters.set(route, likes);
  const shelves = new RateLimiter(browse, MINUTE);
  for (const route of BROWSE_ASKS) limiters.set(route, shelves);
  if (!video) limiters.set("/api/proxy", new RateLimiter(proxy, MINUTE));
  app.addHook("onRequest", async (request, reply) => {
    const route = request.routeOptions.url ?? "";
    const limiter = limiters.get(route);
    if (!limiter) return;
    const day = days.get(route);
    const wait = Math.max(limiter.wait(request.ip), day?.wait(request.ip) ?? 0);
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000);
      return reply.header("Retry-After", seconds).code(429).send({ error: "rate_limited", retryAfter: seconds });
    }
    limiter.hit(request.ip);
    day?.hit(request.ip);
  });
}
