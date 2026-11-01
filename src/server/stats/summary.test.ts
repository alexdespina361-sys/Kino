import { describe, expect, it } from "vitest";
import type { AccountUsage } from "../accounts/store";
import { statsView } from "./summary";

const at = Date.parse("2026-11-01T10:00:00Z");
const on = (day: string, hour = 12) => Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);

const usage: AccountUsage = {
  profiles: 9,
  // three on the 25th, one on the 31st, two today
  madeAt: [on("2026-10-25", 8), on("2026-10-25", 9), on("2026-10-25", 23), on("2026-10-31"), on("2026-11-01", 1), on("2026-11-01", 9)],
  // the last use of the accounts that have a device in
  lastUsedAt: [on("2026-10-20"), on("2026-10-31"), on("2026-11-01", 2), on("2026-11-01", 9)],
  devices: { browser: 5, tv: 2 },
};
const visitDays = new Map([
  ["2026-10-30", { visitors: 4, loads: 9 }],
  ["2026-10-31", { visitors: 6, loads: 8 }],
  ["2026-11-01", { visitors: 3, loads: 5 }],
]);
const you = { address: "203.0.113.9", connection: "10.1.2.3", forwardedFor: "203.0.113.9, 172.70.1.2", cloudflare: "203.0.113.9" };

describe("the owner's stats", () => {
  const view = statsView({
    at,
    days: 3,
    accounts: { usage, limit: 500, signUps: "open" },
    visits: { since: "2026-10-30", days: visitDays },
  });

  it("counts accounts made and used today, in the last 7 days and in the last 30", () => {
    expect(view.accounts).toEqual({
      total: 6,
      profiles: 9,
      limit: 500,
      signUps: "open",
      made: { today: 2, week: 3, month: 6 }, // (the 25th is 7 days back: the week is the 26th to today)
      used: { today: 2, week: 3, month: 4 },
      devices: { browser: 5, tv: 2 },
    });
  });

  it("adds up the visitors and the loads over the same days, from the day there is a count", () => {
    expect(view.visits).toEqual({ since: "2026-10-30", visitors: { today: 3, week: 13, month: 13 }, loads: { today: 5, week: 22, month: 22 } });
  });

  it("passes on how the address of the asking request was read, when it is given", () => {
    expect(statsView({ at, days: 1, you }).you).toEqual(you);
    expect(view.you).toBeUndefined();
  });

  it("lists the last days, the newest last, with how many accounts there were by the end of each", () => {
    expect(view.zone).toBe("UTC");
    expect(view.at).toBe(at);
    expect(view.days).toEqual([
      { day: "2026-10-30", newAccounts: 0, accounts: 3, visitors: 4, loads: 9 },
      { day: "2026-10-31", newAccounts: 1, accounts: 4, visitors: 6, loads: 8 },
      { day: "2026-11-01", newAccounts: 2, accounts: 6, visitors: 3, loads: 5 },
    ]);
  });

  it("has zeros for the days nothing happened and for the days before the count began", () => {
    const longer = statsView({ at, days: 8, accounts: { usage, limit: 500, signUps: "closed" }, visits: { since: "2026-10-30", days: visitDays } });
    expect(longer.days).toHaveLength(8);
    expect(longer.days[0]).toEqual({ day: "2026-10-25", newAccounts: 3, accounts: 3, visitors: 0, loads: 0 });
    expect(longer.days[1]).toEqual({ day: "2026-10-26", newAccounts: 0, accounts: 3, visitors: 0, loads: 0 });
    expect(longer.accounts?.signUps).toBe("closed");
  });

  it("leaves out what it was not given, and says there is no count yet", () => {
    expect(statsView({ at, days: 1, accounts: { usage, limit: 500, signUps: "open" } }).days).toEqual([{ day: "2026-11-01", newAccounts: 2, accounts: 6 }]);
    const noAccounts = statsView({ at, days: 1, visits: { since: undefined, days: new Map() } });
    expect(noAccounts.accounts).toBeUndefined();
    expect(noAccounts.visits).toEqual({ since: null, visitors: { today: 0, week: 0, month: 0 }, loads: { today: 0, week: 0, month: 0 } });
    expect(noAccounts.days).toEqual([{ day: "2026-11-01", visitors: 0, loads: 0 }]);
  });

  it("carries nothing that says who", () => {
    expect(JSON.stringify(view)).not.toMatch(/@|acc_|pro_/);
  });
});
