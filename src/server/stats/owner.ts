import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { feedbackClosed, type Registration } from "../../shared";
import { COOKIE, DEFAULT_MAX_ACCOUNTS, readCookie, signUpsNow } from "../accounts/routes";
import type { AccountStore } from "../accounts/store";
import { teamGuard } from "../feedback/routes";
import type { FeedbackStore } from "../feedback/store";
import { oddHours, type HereNow, type HourAnswers, type LiveCount } from "./live";
import { statsView, type StatsView, type Windows } from "./summary";
import { dayOf, type VisitCounter } from "./visits";

/**
 * The owner's page (the owner, 18 Nov 2026: "a webpage that is hosted on github, where I can see: active users/guests, accounts created,
 * movies/content watched (minutes), feedback received", and "the base for future real time security"): one answer with all of it,
 * `GET /api/owner/stats`, for a page that is kept somewhere else (owner-stats/ in the repository; docs/stats.md says how it is put up).
 *
 * - It has a key of its own (`OWNER_STATS_TOKEN`, 24 characters at least), which reads this one answer and nothing else: not the reports' words, not
 *   the stickers, and it changes nothing. Without it the route is not there (404). A wrong key is slowed for each address, as the team's is.
 * - A page of another site may read it only when it is the one named (`OWNER_STATS_ORIGIN`, an origin, exactly): a browser is told so (CORS), and
 *   nothing else is. The key is what keeps the numbers: the origin only says which page's script a browser lets read the answer.
 * - Counts only. No name, no address, no title of a film; of a report its number, its kind, when, how it stands and its heading.
 */

export const OWNER_STATS = "/api/owner/stats";
const DAY_MS = 24 * 3600 * 1000;
/** How many of the newest reports are listed (what sort each is and how it stands: never its heading or its words, which are a person's own). */
const LATEST_REPORTS = 10;

/** Programs that fetch pages and say so: not people who are here now. */
const NOT_PEOPLE = /bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python|node|go-http|java|headless|lighthouse|pingdom|facebookexternalhit|facebot|embedly|whatsapp|telegram|slack|discord|linkedin/i;

export interface OwnerStatsView {
  at: number;
  zone: "UTC";
  /** Right now: who asked the site something in the last five minutes, and what is connected. */
  now?: HereNow & { tvs?: number; phones?: number };
  accounts?: NonNullable<StatsView["accounts"]> & { pushDevices: number };
  visits?: NonNullable<StatsView["visits"]>;
  /** Minutes of film the signed-in profiles played, all together. */
  watched?: { minutes: Windows };
  feedback?: {
    total: number;
    /** Not closed yet (done, declined and duplicate are closed). */
    open: number;
    /** Nobody of the team has touched it. */
    fresh: number;
    received: Windows;
    latest: Array<{ id: string; at: number; kind: string; area: string; status: string }>;
  };
  /** How the server answered in each of the last 24 hours, the oldest first, and the hours that look unlike the others. */
  answers?: HourAnswers[];
  odd?: ReturnType<typeof oddHours>;
  days: Array<StatsView["days"][number] & { minutes?: number }>;
}

export interface OwnerStatsOptions {
  /** The key of the owner's page (`OWNER_STATS_TOKEN`). Without one long enough, there is no such route. */
  token: string | undefined;
  /** The one page of another site that may read the answer in a browser (`OWNER_STATS_ORIGIN`): an origin, as a browser writes it. */
  origin?: string | undefined;
  accounts?: AccountStore | undefined;
  visits?: VisitCounter | undefined;
  feedback?: FeedbackStore | undefined;
  live?: LiveCount | undefined;
  /** How many screens and phones are connected now. */
  connected?: (() => { tvs: number; phones: number }) | undefined;
  registration?: Registration | undefined;
  maxAccounts?: number | undefined;
  now?: (() => number) | undefined;
}

/** An origin as a browser writes it (`https://name.example`, no path, no slash at the end); nothing for anything else. */
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

/**
 * Counts who is here now and how the server answers (live.ts), as each answer goes out: the site's own api and its two pages. Never the owner's own
 * looks, a robot that says what it is, nor somebody whose browser asks not to be tracked (they are among the answers, which name nobody, and not
 * among the people).
 */
export function countLive(app: FastifyInstance, live: LiveCount): void {
  app.addHook("onResponse", async (request, reply) => {
    const path = (request.url.split("?")[0] ?? "").replace(/\/+$/, "");
    if (path === OWNER_STATS || !(path.startsWith("/api/") || path === "" || path === "/tv")) return;
    live.answered(reply.statusCode);
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
  const keyed = teamGuard(options.token);
  /** Tells a browser that the named page may read the answer (and only that one). */
  const cors = (request: FastifyRequest, reply: Parameters<typeof keyed>[1]) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Vary", "Origin");
    if (allowed && request.headers.origin === allowed) reply.header("Access-Control-Allow-Origin", allowed);
  };
  // (What a browser asks before it sends the key from another site's page.)
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
