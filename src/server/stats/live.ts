import { createHash, randomBytes } from "node:crypto";
import type { Keepable } from "../accounts/rateLimit";

/**
 * What is going on right now, for the owner's page (docs/stats.md, "The owner's page"): how many people are using the site this minute, how many of
 * them signed in, and how the server answered in each of the last hours. Counts only. Who is here is in memory and nowhere else (a restart forgets it); the hours are written down over a restart, as numbers that name nobody.
 *
 * A person is a browser at an address, told from another by a hash of the two, salted with a secret made when the server starts and never written
 * down: the address and the browser's name are only ever hashed, and a hash is let go a quarter of an hour after it was last seen. (The count of
 * visitors by day - visits.ts - is another thing: this one is of the last minutes, and counts whoever asks the site anything, not page loads.)
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A browser that asked nothing for this long is no longer here. */
export const HERE_MS = 5 * MINUTE;
/** ...and is forgotten after this long. */
const KEEP_MS = 15 * MINUTE;
/** No more than this many are kept (a flood of made-up browsers cannot grow what is held). */
export const MAX_HERE = 50_000;
/** How many hours of answers are kept. */
export const HOURS_KEPT = 48;

export interface HereNow {
  /** Browsers that asked the site something in the last five minutes. */
  people: number;
  /** ...of them, the ones that brought a session (signed in). */
  signedIn: number;
  guests: number;
}

/** How the server answered in one hour. */
export interface HourAnswers {
  /** The hour's start (ms, UTC). */
  hour: number;
  /** Every answer to the site's own api and pages. */
  requests: number;
  /** Turned away: not signed in, or not allowed (401, 403). */
  refused: number;
  /** Told to wait (429): somebody asked more than the limits allow. */
  limited: number;
  /** The server's own failures (500 and over). */
  failed: number;
}

export class LiveCount implements Keepable {
  private readonly salt = randomBytes(18).toString("base64url");
  private readonly here = new Map<string, { at: number; signedIn: boolean }>();
  private readonly hours = new Map<number, HourAnswers>();
  private swept = 0;

  constructor(private readonly clock: () => number = Date.now) {}

  /** A browser asked the site something. (The address and the browser's name are only ever seen here, to be hashed.) */
  seen(address: string, agent: string, signedIn: boolean): void {
    const now = this.clock();
    const hash = createHash("sha256").update([this.salt, address, agent.slice(0, 300)].join("\0")).digest("base64url").slice(0, 16);
    const had = this.here.get(hash);
    if (!had && this.here.size >= MAX_HERE) this.sweep(now, true);
    if (had || this.here.size < MAX_HERE) this.here.set(hash, { at: now, signedIn: signedIn || (had?.signedIn === true && now - had.at < HERE_MS) });
    if (now - this.swept > MINUTE) this.sweep(now);
  }

  /** One answer went out. */
  answered(status: number): void {
    const now = this.clock();
    const hour = now - (now % HOUR);
    let at = this.hours.get(hour);
    if (!at) {
      at = { hour, requests: 0, refused: 0, limited: 0, failed: 0 };
      this.hours.set(hour, at);
      for (const old of [...this.hours.keys()]) if (old <= hour - HOURS_KEPT * HOUR) this.hours.delete(old);
    }
    at.requests++;
    if (status === 401 || status === 403) at.refused++;
    else if (status === 429) at.limited++;
    else if (status >= 500) at.failed++;
  }

  private sweep(now: number, hard = false): void {
    this.swept = now;
    for (const [hash, each] of this.here) if (now - each.at > (hard ? HERE_MS : KEEP_MS)) this.here.delete(hash);
  }

  now(): HereNow {
    const now = this.clock();
    let people = 0;
    let signedIn = 0;
    for (const each of this.here.values()) {
      if (now - each.at > HERE_MS) continue;
      people++;
      if (each.signedIn) signedIn++;
    }
    return { people, signedIn, guests: people - signedIn };
  }

  /** How the server answered in the hours that are kept: numbers that name nobody, written down over a restart (accounts/rateLimit.ts). Who is here is not. */
  kept(): unknown {
    const from = this.clock() - HOURS_KEPT * HOUR;
    return [...this.hours.values()].filter((each) => each.hour > from).map((each) => [each.hour, each.requests, each.refused, each.limited, each.failed]);
  }

  restore(data: unknown): void {
    if (!Array.isArray(data)) return;
    const now = this.clock();
    const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);
    for (const each of data.slice(-HOURS_KEPT)) {
      if (!Array.isArray(each)) continue;
      const hour = each[0] as unknown;
      if (typeof hour !== "number" || !Number.isSafeInteger(hour) || hour % HOUR !== 0 || hour > now || hour <= now - HOURS_KEPT * HOUR) continue;
      const had = this.hours.get(hour) ?? { hour, requests: 0, refused: 0, limited: 0, failed: 0 };
      this.hours.set(hour, { hour, requests: had.requests + count(each[1]), refused: had.refused + count(each[2]), limited: had.limited + count(each[3]), failed: had.failed + count(each[4]) });
    }
  }

  /** The last hours, the oldest first, every hour among them (an hour in which nothing was asked is all zeroes). */
  answers(count = 24): HourAnswers[] {
    const now = this.clock();
    const last = now - (now % HOUR);
    return Array.from({ length: Math.min(count, HOURS_KEPT) }, (_, index) => {
      const hour = last - (Math.min(count, HOURS_KEPT) - 1 - index) * HOUR;
      return this.hours.get(hour) ?? { hour, requests: 0, refused: 0, limited: 0, failed: 0 };
    });
  }
}

/**
 * Whether the last whole hour, or the one that is running, looks unlike the ones before it: far more answers that turned somebody away or told
 * somebody to wait, or of the server's own failures, than the usual hour had. A plain rule, said in words, for a person to look into: it stops
 * nothing by itself. (The owner, 18 Nov 2026: the page is "the base for future real time security".)
 */
export function oddHours(hours: readonly HourAnswers[]): Array<{ hour: number; what: "refused" | "limited" | "failed"; count: number; usual: number }> {
  // (Only the hours in which the server answered anything are "the ones before": after a restart there are none for a while, and an hour is not odd
  // for being the first.)
  const before = hours.slice(0, -2).filter((each) => each.requests > 0);
  if (before.length < 6) return [];
  const out: Array<{ hour: number; what: "refused" | "limited" | "failed"; count: number; usual: number }> = [];
  for (const what of ["refused", "limited", "failed"] as const) {
    const sorted = before.map((each) => each[what]).sort((a, b) => a - b);
    const usual = sorted[Math.floor(sorted.length / 2)] ?? 0;
    for (const each of hours.slice(-2)) {
      // (Five times the usual hour, and enough of them to be more than one person's slip.)
      if (each[what] >= 30 && each[what] > 5 * Math.max(usual, 2)) out.push({ hour: each.hour, what, count: each[what], usual });
    }
  }
  return out;
}
