import type { Registration } from "../../shared";
import type { AccountUsage } from "../accounts/store";
import { dayOf, type DayVisits } from "./visits";

const DAY_MS = 24 * 3600 * 1000;

export interface Windows {
  today: number;
  week: number;
  month: number;
}

export interface RequestSeen {
  address: string;
  connection: string | null;
  forwardedFor: string | null;
  cloudflare: string | null;
}

export interface StatsView {
  at: number;
  zone: "UTC";
  accounts?: {
    total: number;
    profiles: number;
    limit: number;
    signUps: Registration;
    made: Windows;
    used: Windows;
    devices: Record<string, number>;
  };
  visits?: {
    since: string | null;
    visitors: Windows;
    loads: Windows;
  };
  you?: RequestSeen;
  days: Array<{ day: string; newAccounts?: number; accounts?: number; visitors?: number; loads?: number }>;
}

export interface StatsInput {
  at: number;
  days: number;
  accounts?: { usage: AccountUsage; limit: number; signUps: Registration };
  visits?: { since: string | undefined; days: ReadonlyMap<string, DayVisits> };
  you?: RequestSeen;
}

export function statsView({ at, days, accounts, visits, you }: StatsInput): StatsView {
  const back = (n: number) => dayOf(at - n * DAY_MS);
  const listed = Array.from({ length: days }, (_, index) => back(days - 1 - index));
  const windows = (count: (day: string) => number): Windows => {
    const sum = (span: number) => Array.from({ length: span }, (_, n) => count(back(n))).reduce((total, each) => total + each, 0);
    return { today: sum(1), week: sum(7), month: sum(30) };
  };
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
          },
        }
      : {}),
    ...(you ? { you } : {}),
    days: listed.map((day) => ({
      day,
      ...(accounts && made ? { newAccounts: made.get(day) ?? 0, accounts: accounts.usage.madeAt.filter((moment) => dayOf(moment) <= day).length } : {}),
      ...(visits ? { visitors: visits.days.get(day)?.visitors ?? 0, loads: visits.days.get(day)?.loads ?? 0 } : {}),
    })),
  };
}
