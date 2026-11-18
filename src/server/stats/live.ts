import { createHash, randomBytes } from "node:crypto";
import type { Keepable } from "../accounts/rateLimit";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const HERE_MS = 5 * MINUTE;
const KEEP_MS = 15 * MINUTE;
export const MAX_HERE = 50_000;
export const HOURS_KEPT = 48;
export const BROWSERS_PER_ADDRESS = 8;
const HARD_SWEEP_MS = 1000;

export interface HereNow {
  people: number;
  signedIn: number;
  guests: number;
}

export interface HourAnswers {
  hour: number;
  requests: number;
  refused: number;
  limited: number;
  failed: number;
}

export class LiveCount implements Keepable {
  private readonly salt = randomBytes(18).toString("base64url");
  private readonly here = new Map<string, { at: number; signedIn: boolean; from: string }>();
  private readonly fromAddress = new Map<string, number>();
  private readonly hours = new Map<number, HourAnswers>();
  private swept = 0;
  private sweptHard = -Infinity;

  constructor(private readonly clock: () => number = Date.now) {}

  seen(address: string, agent: string, signedIn: boolean): void {
    const now = this.clock();
    const hash = this.hashOf(address, agent.slice(0, 300));
    const had = this.here.get(hash);
    if (!had) {
      const from = this.hashOf(address);
      if (this.here.size >= MAX_HERE && now - this.sweptHard >= HARD_SWEEP_MS) {
        this.sweptHard = now;
        this.sweep(now, true);
      }
      if (this.here.size < MAX_HERE && (this.fromAddress.get(from) ?? 0) < BROWSERS_PER_ADDRESS) {
        this.here.set(hash, { at: now, signedIn, from });
        this.fromAddress.set(from, (this.fromAddress.get(from) ?? 0) + 1);
      }
    } else {
      this.here.set(hash, { at: now, signedIn: signedIn || (had.signedIn && now - had.at < HERE_MS), from: had.from });
    }
    if (now - this.swept > MINUTE) this.sweep(now);
  }

  private hashOf(...parts: string[]): string {
    return createHash("sha256").update([this.salt, ...parts].join("\0")).digest("base64url").slice(0, 16);
  }

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
    for (const [hash, each] of this.here) {
      if (now - each.at <= (hard ? HERE_MS : KEEP_MS)) continue;
      this.here.delete(hash);
      const left = (this.fromAddress.get(each.from) ?? 1) - 1;
      if (left > 0) this.fromAddress.set(each.from, left);
      else this.fromAddress.delete(each.from);
    }
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

  answers(count = 24): HourAnswers[] {
    const now = this.clock();
    const last = now - (now % HOUR);
    return Array.from({ length: Math.min(count, HOURS_KEPT) }, (_, index) => {
      const hour = last - (Math.min(count, HOURS_KEPT) - 1 - index) * HOUR;
      return this.hours.get(hour) ?? { hour, requests: 0, refused: 0, limited: 0, failed: 0 };
    });
  }
}

export function oddHours(hours: readonly HourAnswers[]): Array<{ hour: number; what: "refused" | "limited" | "failed"; count: number; usual: number }> {
  const before = hours.slice(0, -2).filter((each) => each.requests > 0);
  if (before.length < 6) return [];
  const out: Array<{ hour: number; what: "refused" | "limited" | "failed"; count: number; usual: number }> = [];
  for (const what of ["refused", "limited", "failed"] as const) {
    const sorted = before.map((each) => each[what]).sort((a, b) => a - b);
    const usual = sorted[Math.floor(sorted.length / 2)] ?? 0;
    for (const each of hours.slice(-2)) {
      if (each[what] >= 30 && each[what] > 5 * Math.max(usual, 2)) out.push({ hour: each.hour, what, count: each[what], usual });
    }
  }
  return out;
}
