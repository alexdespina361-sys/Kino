import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { feedbackClosed, type Registration } from "../../shared";
import { COOKIE, DEFAULT_MAX_ACCOUNTS, readCookie, signUpsNow } from "../accounts/routes";
import type { AccountStore } from "../accounts/store";
import { teamGuard } from "../feedback/routes";
import type { FeedbackStore } from "../feedback/store";
import { oddHours, type HereNow, type HourAnswers, type LiveCount } from "./live";
import { statsView, type StatsView, type Windows } from "./summary";
import { dayOf, type VisitCounter } from "./visits";

export const OWNER_STATS = "/api/owner/stats";
const DAY_MS = 24 * 3600 * 1000;
const LATEST_REPORTS = 10;

const NOT_PEOPLE = /bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python|node|go-http|java|headless|lighthouse|pingdom|facebookexternalhit|facebot|embedly|whatsapp|telegram|slack|discord|linkedin/i;

export interface OwnerStatsView {
  at: number;
  zone: "UTC";
  now?: HereNow & { tvs?: number; phones?: number };
  accounts?: NonNullable<StatsView["accounts"]> & { pushDevices: number };
  visits?: NonNullable<StatsView["visits"]>;
  watched?: { minutes: Windows };
  feedback?: {
    total: number;
    open: number;
    fresh: number;
    received: Windows;
    latest: Array<{ id: string; at: number; kind: string; area: string; status: string }>;
  };
  answers?: HourAnswers[];
  odd?: ReturnType<typeof oddHours>;
  days: Array<StatsView["days"][number] & { minutes?: number }>;
}

export interface OwnerStatsOptions {
  token: string | undefined;
  origin?: string | undefined;
  accounts?: AccountStore | undefined;
  visits?: VisitCounter | undefined;
  feedback?: FeedbackStore | undefined;
  live?: LiveCount | undefined;
  connected?: (() => { tvs: number; phones: number }) | undefined;
  registration?: Registration | undefined;
  maxAccounts?: number | undefined;
  now?: (() => number) | undefined;
}

export function originOf(text: string | undefined): string | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value.replace(/\/$/, "") ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export function countLive(app: FastifyInstance, live: LiveCount): void {
  app.addHook("onResponse", async (request, reply) => {
    const path = (request.url.split("?")[0] ?? "").replace(/\/+$/, "");
    if (path === OWNER_STATS || !(path.startsWith("/api/") || path === "" || path === "/tv")) return;
    live.answered(reply.statusCode);
    if (!path.startsWith("/api/")) return;
    const from = request.headers["sec-fetch-site"];
    if (from && from !== "same-origin") return;
    const agent = String(request.headers["user-agent"] ?? "");
    if (!agent || NOT_PEOPLE.test(agent) || request.headers.dnt === "1" || request.headers["sec-gpc"] === "1") return;
    live.seen(request.ip, agent, Boolean(readCookie(request.headers.cookie, COOKIE)));
  });
}

export function ownerView(options: Omit<OwnerStatsOptions, "token" | "origin">, days: number): OwnerStatsView {
  const { accounts, visits, feedback, live, connected, registration = "open", maxAccounts = DEFAULT_MAX_ACCOUNTS } = options;
  const at = (options.now ?? Date.now)();
  const kept = visits?.records();
  const base = statsView({
    at,
    days,
    ...(accounts ? { accounts: { usage: accounts.usage(), limit: maxAccounts, signUps: signUpsNow(registration, accounts.countAccounts(), maxAccounts) } } : {}),
    ...(kept ? { visits: kept } : {}),
  });
  const back = (n: number) => dayOf(at - n * DAY_MS);
  const windows = (count: (day: string) => number): Windows => {
    const sum = (span: number) => Array.from({ length: span }, (_, n) => count(back(n))).reduce((total, each) => total + each, 0);
    return { today: sum(1), week: sum(7), month: sum(30) };
  };
  const minutes = (day: string) => Math.round((kept?.days.get(day)?.watched ?? 0) / 60);
  const reports = feedback?.list() ?? [];
  const sentOn = new Map<string, number>();
  for (const report of reports) sentOn.set(dayOf(report.createdAt), (sentOn.get(dayOf(report.createdAt)) ?? 0) + 1);
  const hours = live?.answers(24);
  const here = live?.now();
  const sockets = connected?.();
  return {
    at,
    zone: "UTC",
    ...(here || sockets ? { now: { ...(here ?? { people: 0, signedIn: 0, guests: 0 }), ...(sockets ?? {}) } } : {}),
    ...(base.accounts && accounts ? { accounts: { ...base.accounts, pushDevices: accounts.countPushDevices() } } : {}),
    ...(base.visits ? { visits: base.visits } : {}),
    ...(kept ? { watched: { minutes: windows(minutes) } } : {}),
    ...(feedback
      ? {
          feedback: {
            total: reports.length,
            open: reports.filter((report) => !feedbackClosed(report.status)).length,
            fresh: reports.filter((report) => report.status === "new").length,
            received: windows((day) => sentOn.get(day) ?? 0),
            latest: [...reports]
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, LATEST_REPORTS)
              .map((report) => ({ id: report.id, at: report.createdAt, kind: report.kind, area: report.area, status: report.status })),
          },
        }
      : {}),
    ...(hours ? { answers: hours, odd: oddHours(hours) } : {}),
    days: base.days.map((day) => ({ ...day, ...(kept ? { minutes: minutes(day.day) } : {}) })),
  };
}

export const ownerStatsRoutes: FastifyPluginAsync<OwnerStatsOptions> = async (app, options) => {
  const allowed = originOf(options.origin);
  const keyed = teamGuard(options.token, "owner.stats");
  const cors = (request: FastifyRequest, reply: Parameters<typeof keyed>[1]) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Vary", "Origin");
    if (allowed && request.headers.origin === allowed) reply.header("Access-Control-Allow-Origin", allowed);
  };
  app.options(OWNER_STATS, async (request, reply) => {
    cors(request, reply);
    if (!allowed || request.headers.origin !== allowed) return reply.code(404).send({ error: "NOT_FOUND" });
    return reply.header("Access-Control-Allow-Methods", "GET").header("Access-Control-Allow-Headers", "Authorization").header("Access-Control-Max-Age", "600").code(204).send();
  });
  app.get<{ Querystring: { days?: string } }>(OWNER_STATS, async (request, reply) => {
    cors(request, reply);
    if (!keyed(request, reply)) return;
    const days = Math.min(90, Math.max(1, Math.floor(Number(request.query.days)) || 30));
    return reply.send(ownerView(options, days));
  });
};
