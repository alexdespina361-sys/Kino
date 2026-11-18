import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { Registration } from "../../shared";
import { DEFAULT_MAX_ACCOUNTS, signUpsNow } from "../accounts/routes";
import type { AccountStore } from "../accounts/store";
import { teamGuard } from "../feedback/routes";
import type { UnavailableStore } from "../library/unavailable";
import { statsView, type RequestSeen } from "./summary";
import type { VisitCounter } from "./visits";

const NOT_PEOPLE = /bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python|node|go-http|java|headless|lighthouse|pingdom|facebookexternalhit|facebot|embedly|whatsapp|telegram|slack|discord|linkedin/i;

const header = (request: FastifyRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

const seenAs = (request: FastifyRequest): RequestSeen => ({
  address: request.ip,
  connection: request.socket.remoteAddress ?? null,
  forwardedFor: header(request, "x-forwarded-for") ?? null,
  cloudflare: header(request, "cf-connecting-ip") ?? null,
});

export function countVisits(app: FastifyInstance, counter: VisitCounter): void {
  app.addHook("onResponse", async (request, reply) => {
    if (request.method !== "GET" || reply.statusCode !== 200) return;
    if ((request.url.split("?")[0] ?? "").replace(/\/+$/, "") !== "/api/me") return;
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
  adminToken: string | undefined;
  accounts?: AccountStore | undefined;
  visits?: VisitCounter | undefined;
  unavailable?: UnavailableStore | undefined;
  registration?: Registration | undefined;
  maxAccounts?: number | undefined;
  now?: (() => number) | undefined;
}

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
