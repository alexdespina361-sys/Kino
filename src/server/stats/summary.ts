import type { Registration } from "../../shared";
import type { AccountUsage } from "../accounts/store";
import { dayOf, type AddressSource, type DayVisits } from "./visits";

const DAY_MS = 24 * 3600 * 1000;

/** A number for today, for the last seven days and for the last thirty (whole UTC days, today among them). */
export interface Windows {
  today: number;
  week: number;
  month: number;
}

/** What the owner sees (`GET /api/admin/stats`, `scripts/stats.mjs`): counts and days, never a person. */
export interface StatsView {
  /** When this was worked out (ms). */
  at: number;
  /** The days are UTC days: a day ends at 02:00 (03:00 in summer) in Romania. */
  zone: "UTC";
  accounts?: {
    total: number;
    profiles: number;
    /** No new accounts beyond this many. */
    limit: number;
    signUps: Registration;
    /** Accounts made in those days. */
    made: Windows;
    /** Accounts with a device that was used in those days (a device that signed out is not counted: it is not kept). */
    used: Windows;
    /** Devices signed in, by what they are. */
    devices: Record<string, number>;
  };
  visits?: {
    /** The first day there is a count for: nobody was counted before it. */
    since: string | null;
    /** Visitors added up over those days, so a person who came on three days is three. */
    visitors: Windows;
    /** Page loads in those days. */
    loads: Windows;
    /** Where the visitors' addresses were read from since the server started (page loads): when a proxy is in front and most are `connection`, the address is the proxy's and the counts are too low. */
    addressFrom: Record<AddressSource, number>;
  };
  /** The last days, the newest last. */
  days: Array<{ day: string; newAccounts?: number; accounts?: number; visitors?: number; loads?: number }>;
}

export interface StatsInput {
  at: number;
  /** How many days to list. */
  days: number;
  accounts?: { usage: AccountUsage; limit: number; signUps: Registration };
  visits?: { since: string | undefined; days: ReadonlyMap<string, DayVisits>; sources: Readonly<Record<AddressSource, number>> };
}

export function statsView({ at, days, accounts, visits }: StatsInput): StatsView {
  const back = (n: number) => dayOf(at - n * DAY_MS);
  const listed = Array.from({ length: days }, (_, index) => back(days - 1 - index));
  const windows = (count: (day: string) => number): Windows => {
    const sum = (span: number) => Array.from({ length: span }, (_, n) => count(back(n))).reduce((total, each) => total + each, 0);
    return { today: sum(1), week: sum(7), month: sum(30) };
  };
  // (Moments become days once: a day is a string that sorts the way days do.)
  const perDay = (moments: number[]) => {
    const counts = new Map<string, number>();
    for (const moment of moments) {
      const day = dayOf(moment);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return counts;
  };
  const made = accounts && perDay(accounts.usage.madeAt);
  const used = accounts && perDay(accounts.usage.lastUsedAt);

  return {
    at,
    zone: "UTC",
    ...(accounts && made && used
      ? {
          accounts: {
            total: accounts.usage.madeAt.length,
            profiles: accounts.usage.profiles,
            limit: accounts.limit,
            signUps: accounts.signUps,
            made: windows((day) => made.get(day) ?? 0),
            used: windows((day) => used.get(day) ?? 0),
            devices: accounts.usage.devices,
          },
        }
      : {}),
    ...(visits
      ? {
          visits: {
            since: visits.since ?? null,
            visitors: windows((day) => visits.days.get(day)?.visitors ?? 0),
            loads: windows((day) => visits.days.get(day)?.loads ?? 0),
            addressFrom: { ...visits.sources },
          },
        }
      : {}),
    days: listed.map((day) => ({
      day,
      ...(accounts && made ? { newAccounts: made.get(day) ?? 0, accounts: accounts.usage.madeAt.filter((moment) => dayOf(moment) <= day).length } : {}),
      ...(visits ? { visitors: visits.days.get(day)?.visitors ?? 0, loads: visits.days.get(day)?.loads ?? 0 } : {}),
    })),
  };
}
