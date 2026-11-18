import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { Registration } from "../../shared";
import { DEFAULT_MAX_ACCOUNTS, signUpsNow } from "../accounts/routes";
import type { AccountStore } from "../accounts/store";
import { teamGuard } from "../feedback/routes";
import type { UnavailableStore } from "../library/unavailable";
import { statsView, type RequestSeen } from "./summary";
import type { VisitCounter } from "./visits";

/** Programs that say what they are (search engines, link previews, uptime checks, scripts): never counted, whatever they ask. */
const NOT_PEOPLE = /bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python|node|go-http|java|headless|lighthouse|pingdom|facebookexternalhit|facebot|embedly|whatsapp|telegram|slack|discord|linkedin/i;

const header = (request: FastifyRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/** How the server read this request's address, to show to whoever asked (see `RequestSeen`). */
const seenAs = (request: FastifyRequest): RequestSeen => ({
  address: request.ip,
  connection: request.socket.remoteAddress ?? null,
  forwardedFor: header(request, "x-forwarded-for") ?? null,
  cloudflare: header(request, "cf-connecting-ip") ?? null,
});

/**
 * Count the people who open the site: a browser in which the page started. The first thing the page does when it runs is ask who is signed in
 * (`GET /api/me`, at every start), and that question is what is counted, not the page's file. A program that only fetches the page (a scanner with a
 * browser's name, which is most of what asks a public address for `/`: on 18 Nov 2026 the page was fetched 133 times and started 19 times) runs
 * nothing and asks nothing, so it is nobody. Not counted either: the question asked any other way than by the site's own page (from another site,
 * typed as an address), a robot that says so, and people who send Do Not Track or Global Privacy Control, who asked not to be. It runs after the
 * answer is sent, so it can never slow a page or break one.
 *
 * The visitor is `request.ip`, which the app has read through the proxies in front of it (`trust.ts`). The address is only ever hashed (see `VisitCounter`).
 */
export function countVisits(app: FastifyInstance, counter: VisitCounter): void {
  app.addHook("onResponse", async (request, reply) => {
    if (request.method !== "GET" || reply.statusCode !== 200) return;
    if ((request.url.split("?")[0] ?? "").replace(/\/+$/, "") !== "/api/me") return;
    // (A browser says where a request comes from and what for: the page's own question is from the same site and is no page, picture or frame.
    // An old TV's browser says neither, and is counted.)
    const from = header(request, "sec-fetch-site");
    if (from && from !== "same-origin") return;
    const destination = header(request, "sec-fetch-dest");
    if (destination && destination !== "empty") return;
    if (header(request, "dnt") === "1" || header(request, "sec-gpc") === "1") return;
    const agent = header(request, "user-agent") ?? "";
    if (!agent || NOT_PEOPLE.test(agent)) return;
    counter.count(request.ip, agent, header(request, "accept-language") ?? "");
  });
}
export interface StatsRoutesOptions {
  /** The team's token (`FEEDBACK_ADMIN_TOKEN`): the owner's stats are read with the same one. Without it there is nothing to ask. */
  adminToken: string | undefined;
  accounts?: AccountStore | undefined;
  visits?: VisitCounter | undefined;
  /** What nobody could play, for `GET /api/admin/unavailable`. */
  unavailable?: UnavailableStore | undefined;
  registration?: Registration | undefined;
  maxAccounts?: number | undefined;
  now?: (() => number) | undefined;
}

/** The owner's stats, `GET /api/admin/stats?days=30`: how many accounts and how many visitors, by day (see `summary.ts`), and how the server read the address of the request that asked. Counts only; the team's token and nothing else. */
export const statsRoutes: FastifyPluginAsync<StatsRoutesOptions> = async (app, { adminToken, accounts, visits, unavailable, registration = "open", maxAccounts = DEFAULT_MAX_ACCOUNTS, now = Date.now }) => {
  const team = teamGuard(adminToken, "team.stats");
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });
  app.get<{ Querystring: { days?: string } }>("/api/admin/stats", async (request, reply) => {
    if (!team(request, reply)) return;
    const days = Math.min(400, Math.max(1, Math.floor(Number(request.query.days)) || 30));
    return reply.send(
      statsView({
        at: now(),
        days,
        ...(accounts ? { accounts: { usage: accounts.usage(), limit: maxAccounts, signUps: signUpsNow(registration, accounts.countAccounts(), maxAccounts) } } : {}),
        ...(visits ? { visits: visits.records() } : {}),
        you: seenAs(request),
      }),
    );
  });
  // What nobody could play, the most asked for first, for whoever looks for sources (`node scripts/unavailable.mjs`): titles, episodes and dates, never who pressed Play.
  app.get<{ Querystring: { all?: string } }>("/api/admin/unavailable", async (request, reply) => {
    if (!team(request, reply)) return;
    const records = unavailable?.list() ?? [];
    const shown = request.query.all === "1" ? records : records.filter((record) => record.marked);
    return reply.send({
      at: now(),
      total: records.length,
      marked: records.filter((record) => record.marked).length,
      items: shown.map(({ title, kind, titleId, season, episode, link, occasions, first, last, marked }) => ({
        ...(title ? { title } : {}),
        ...(kind ? { kind } : {}),
        titleId,
        ...(season !== undefined ? { season } : {}),
        ...(episode !== undefined ? { episode } : {}),
        link,
        occasions,
        first,
        last,
        marked,
      })),
    });
  });
};
