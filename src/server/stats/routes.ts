import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { Registration } from "../../shared";
import { DEFAULT_MAX_ACCOUNTS, signUpsNow } from "../accounts/routes";
import type { AccountStore } from "../accounts/store";
import { teamGuard } from "../feedback/routes";
import { statsView } from "./summary";
import type { VisitCounter } from "./visits";

/** Programs that fetch pages and say so (search engines, link previews, uptime checks, scripts). Anything that calls itself a browser is counted. */
const NOT_PEOPLE = /bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python|node|go-http|java|headless|lighthouse|pingdom|facebookexternalhit|facebot|embedly|whatsapp|telegram|slack|discord|linkedin/i;

const header = (request: FastifyRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Count the people who open the site: a page load of `/` (the phone) or `/tv`, in a browser, that was answered (a page the browser already has comes back as a 304,
 * and is a visit all the same). Not counted: anything but a person opening a page (assets, the api, a link preview, a prefetch, a robot that says so), and people
 * who send Do Not Track or Global Privacy Control, who asked not to be. It runs after the answer is sent, so it can never slow a page or break one.
 *
 * `behindProxy` says that a proxy of the host's sits in front (so the headers it sets can be believed): then the visitor is the address Cloudflare saw, or
 * else the first one in X-Forwarded-For. The address is only ever hashed (see `VisitCounter`).
 */
export function countVisits(app: FastifyInstance, { counter, behindProxy }: { counter: VisitCounter; behindProxy: boolean }): void {
  app.addHook("onResponse", async (request, reply) => {
    if (request.method !== "GET" || (reply.statusCode !== 200 && reply.statusCode !== 304)) return;
    const page = (request.url.split("?")[0] ?? "").replace(/\/+$/, "");
    if (page !== "" && page !== "/tv") return;
    if (!header(request, "accept")?.includes("text/html")) return;
    const destination = header(request, "sec-fetch-dest");
    if (destination && destination !== "document") return;
    if (/prefetch/i.test(`${header(request, "sec-purpose") ?? ""} ${header(request, "purpose") ?? ""} ${header(request, "x-moz") ?? ""}`)) return;
    if (header(request, "dnt") === "1" || header(request, "sec-gpc") === "1") return;
    const agent = header(request, "user-agent") ?? "";
    if (!agent || NOT_PEOPLE.test(agent)) return;
    const cloudflare = behindProxy ? header(request, "cf-connecting-ip")?.trim() : undefined;
    const forwarded = behindProxy && !cloudflare ? header(request, "x-forwarded-for")?.split(",")[0]?.trim() : undefined;
    counter.count(cloudflare || forwarded || request.ip, agent, header(request, "accept-language") ?? "", cloudflare ? "cloudflare" : forwarded ? "forwarded" : "connection");
  });
}

export interface StatsRoutesOptions {
  /** The team's token (`FEEDBACK_ADMIN_TOKEN`): the owner's stats are read with the same one. Without it there is nothing to ask. */
  adminToken: string | undefined;
  accounts?: AccountStore | undefined;
  visits?: VisitCounter | undefined;
  registration?: Registration | undefined;
  maxAccounts?: number | undefined;
  now?: (() => number) | undefined;
}

/** The owner's stats, `GET /api/admin/stats?days=30`: how many accounts and how many visitors, by day (see `summary.ts`). Counts only; the team's token and nothing else. */
export const statsRoutes: FastifyPluginAsync<StatsRoutesOptions> = async (app, { adminToken, accounts, visits, registration = "open", maxAccounts = DEFAULT_MAX_ACCOUNTS, now = Date.now }) => {
  const team = teamGuard(adminToken);
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
      }),
    );
  });
};
