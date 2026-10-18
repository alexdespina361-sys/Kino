import { describe, expect, it } from "vitest";
import { PLAN_KEEP_AFTER_MS, PLAN_MAX_AHEAD_MS, PLAN_MIN_AHEAD_MS, type InboxItem, type PlanItem } from "../../shared";
import { setLanguage, t } from "../i18n";
import { PLAN_DAYS, PLAN_HOURS, dateValue, defaultPlan, duePlans, inboxToShow, momentOf, nextPlanMoment, planLines, planMoment, planOffered, planStatus, timeValue, whenLabel, whenText } from "./plans";

/** A moment by this machine's own clock: a plan is shown in the viewer's own time, so the tests go by the clock they run on, not by UTC. November 2026. */
const at = (day: number, hour = 0, minute = 0): number => new Date(2026, 10, day, hour, minute).getTime();
const NOW = at(12, 14, 30); // Thursday the 12th, half past two
const HOUR = 3_600_000;
const SOON = NOW + HOUR;

const plan = (id: string, when: number, extra: Partial<PlanItem> = {}, from = "pro_sam"): PlanItem => ({ kind: "plan", id, from, at: NOW - 1000, read: false, when, ...extra });
const recommendation: InboxItem = { kind: "recommend", id: "r", from: "pro_sam", at: NOW, read: false, title: "Dune", url: "https://filmpire.sc/watch/1" };
const ids = (items: readonly InboxItem[]) => items.map((item) => item.id);

describe("where a plan stands", () => {
  it("asks while nobody has answered and its time is ahead", () => {
    expect(planStatus(plan("a", SOON), NOW)).toBe("asks");
    expect(planStatus(plan("a", SOON), SOON - 1)).toBe("asks");
  });

  it("is over when nobody answered by its time", () => {
    expect(planStatus(plan("a", SOON), SOON)).toBe("lapsed");
    expect(planStatus(plan("a", SOON), SOON + 5 * HOUR)).toBe("lapsed");
  });

  it("is on after a yes until its time, due from its time for two hours, and over after that", () => {
    const yes = plan("a", SOON, { answer: "yes" });
    expect(planStatus(yes, NOW)).toBe("agreed");
    expect(planStatus(yes, SOON - 1)).toBe("agreed");
    expect(planStatus(yes, SOON)).toBe("due");
    expect(planStatus(yes, SOON + PLAN_KEEP_AFTER_MS - 1)).toBe("due");
    expect(planStatus(yes, SOON + PLAN_KEEP_AFTER_MS)).toBe("lapsed");
  });

  it("is the news that a friend cannot make it after a no, for as long as the server keeps it", () => {
    const no = plan("a", SOON, { answer: "no" });
    expect(planStatus(no, NOW)).toBe("declined");
    expect(planStatus(no, SOON + 5 * HOUR)).toBe("declined");
  });
});

describe("the plans among the rest of the inbox", () => {
  const over = plan("over", NOW - 1);
  const doneLongAgo = plan("done", NOW - PLAN_KEEP_AFTER_MS - 1, { answer: "yes" });

  it("are shown, but for the ones that are over, and nothing else of the inbox is touched", () => {
    expect(ids(inboxToShow([recommendation, plan("ask", SOON), over, doneLongAgo, plan("no", NOW - 1, { answer: "no" })], NOW))).toEqual(["r", "ask", "no"]);
    expect(inboxToShow([], NOW)).toEqual([]);
  });

  it("are the ones whose time has come, and only those that were agreed to", () => {
    const due = plan("due", NOW - 1, { answer: "yes" });
    expect(ids(duePlans([recommendation, due, plan("ahead", NOW + 1, { answer: "yes" }), plan("unanswered", NOW - 1), plan("no", NOW - 1, { answer: "no" }), doneLongAgo, over], NOW))).toEqual(["due"]);
  });
});

describe("when something about a plan changes by itself", () => {
  it("is never, with no plan that will", () => {
    expect(nextPlanMoment([], NOW)).toBeUndefined();
    expect(nextPlanMoment([recommendation], NOW)).toBeUndefined();
    expect(nextPlanMoment([plan("no", SOON, { answer: "no" }), plan("over", NOW - 1)], NOW)).toBeUndefined();
  });

  it("is, for a plan that asks, its time, and for one that is on, its time and then the end of the two hours after it", () => {
    expect(nextPlanMoment([plan("ask", SOON)], NOW)).toBe(SOON);
    const yes = plan("yes", SOON, { answer: "yes" });
    expect(nextPlanMoment([yes], NOW)).toBe(SOON);
    expect(nextPlanMoment([yes], SOON)).toBe(SOON + PLAN_KEEP_AFTER_MS);
    expect(nextPlanMoment([yes], SOON + PLAN_KEEP_AFTER_MS)).toBeUndefined();
  });

  it("is the soonest of several, and an answer of no changes nothing by itself", () => {
    expect(nextPlanMoment([plan("late", SOON + 5000, { answer: "yes" }), plan("soonest", SOON - 5000), plan("no", NOW + 1, { answer: "no" })], NOW)).toBe(SOON - 5000);
  });
});

describe("what a plan says", () => {
  const saturday = at(14, 20);

  it("is, in English, who proposes and when, in the viewer's own time", () => {
    expect(planLines(plan("a", saturday), "Sam", NOW)).toEqual({ heading: "Sam proposes to watch together", detail: "Saturday at 20:00" });
    expect(whenLabel(at(13, 20), NOW)).toBe("Tomorrow at 20:00");
    expect(whenText(at(13, 20), NOW)).toBe("tomorrow at 20:00");
    expect(whenLabel(at(12, 21, 5), NOW)).toBe("Today at 21:05");
  });

  it("puts the few words that came with the plan after the time", () => {
    expect(planLines(plan("a", saturday, { note: "bring snacks" }), "Sam", NOW).detail).toBe(`${whenLabel(saturday, NOW)} · bring snacks`);
  });

  it("says a plan that is on, one whose time has come, and one a friend cannot make, each in its own words", () => {
    expect(planLines(plan("a", saturday, { answer: "yes" }), "Sam", NOW)).toEqual({ heading: t("friends.planAgreed", { name: "Sam" }), detail: whenLabel(saturday, NOW) });
    expect(planLines(plan("a", NOW - 60_000, { answer: "yes" }), "Sam", NOW).heading).toBe(t("friends.planDue", { name: "Sam" }));
    expect(planLines(plan("a", saturday, { answer: "no", note: "a note" }), "Sam", NOW)).toEqual({ heading: t("friends.planDeclined", { name: "Sam" }), detail: whenLabel(saturday, NOW) }); // (the news is the time alone)
  });

  it("is said in the language of the site", () => {
    setLanguage("ro", false);
    try {
      expect(whenText(at(13, 20), NOW)).toBe("mâine la 20:00");
      expect(planLines(plan("a", at(14, 20)), "Sam", NOW).heading).toBe("Sam propune să vă uitați împreună");
    } finally {
      setLanguage("en", false);
    }
    setLanguage("it", false);
    try {
      expect(whenText(at(13, 20), NOW)).toBe("domani alle 20:00");
    } finally {
      setLanguage("en", false);
    }
  });
});

describe("choosing a time with the remote", () => {
  it("offers the hours of the evening, over a week", () => {
    expect(PLAN_DAYS).toBe(7);
    expect([...PLAN_HOURS]).toEqual([...PLAN_HOURS].sort((a, b) => a - b));
    expect(PLAN_HOURS).toContain(20);
  });

  it("puts an hour of a day by the viewer's own clock, whatever the hour of the moment it starts from", () => {
    expect(planMoment(NOW, 0, 20)).toBe(at(12, 20));
    expect(planMoment(NOW, 2, 19)).toBe(at(14, 19));
    expect(planMoment(at(12, 0, 1), 0, 20)).toBe(at(12, 20));
    expect(planMoment(at(12, 23, 59), 1, 8)).toBe(at(13, 8));
  });

  it("offers only what the server takes: not under five minutes ahead, not over thirty days", () => {
    expect(planOffered(NOW + PLAN_MIN_AHEAD_MS, NOW)).toBe(true);
    expect(planOffered(NOW + PLAN_MIN_AHEAD_MS - 1, NOW)).toBe(false);
    expect(planOffered(NOW - HOUR, NOW)).toBe(false);
    expect(planOffered(NOW + PLAN_MAX_AHEAD_MS, NOW)).toBe(true);
    expect(planOffered(NOW + PLAN_MAX_AHEAD_MS + 1, NOW)).toBe(false);
    for (let day = 0; day < PLAN_DAYS; day++) expect(PLAN_MAX_AHEAD_MS).toBeGreaterThan(planMoment(NOW, day, 22) - NOW); // (every day that is offered can be sent)
  });

  it("starts on eight in the evening, or the next evening hour that is still ahead, or tomorrow at eight when the evening is gone", () => {
    expect(defaultPlan(at(12, 14, 30))).toEqual({ day: 0, hour: 20 });
    expect(defaultPlan(at(12, 19, 56))).toEqual({ day: 0, hour: 21 }); // (eight is under five minutes away)
    expect(defaultPlan(at(12, 20, 30))).toEqual({ day: 0, hour: 21 });
    expect(defaultPlan(at(12, 21, 50))).toEqual({ day: 0, hour: 22 });
    expect(defaultPlan(at(12, 21, 56))).toEqual({ day: 1, hour: 20 }); // (ten at night is under five minutes away)
    expect(defaultPlan(at(12, 22, 30))).toEqual({ day: 1, hour: 20 });
    expect(defaultPlan(at(12, 23, 59))).toEqual({ day: 1, hour: 20 });
  });

  it("starts on something that can be sent", () => {
    for (const hour of [0, 8, 14, 19, 20, 21, 22, 23]) {
      const now = at(12, hour, 30);
      const start = defaultPlan(now);
      expect(planOffered(planMoment(now, start.day, start.hour), now)).toBe(true);
    }
  });
});

describe("the date and time of a phone's own pickers", () => {
  it("are a moment as the date and the time of the viewer's own clock", () => {
    expect(dateValue(at(14, 20, 5))).toBe("2026-11-14");
    expect(timeValue(at(14, 20, 5))).toBe("20:05");
    expect(dateValue(at(3, 0, 0))).toBe("2026-11-03");
    expect(timeValue(at(3, 0, 0))).toBe("00:00");
  });

  it("are read back into the same moment", () => {
    expect(momentOf("2026-11-14", "20:05")).toBe(at(14, 20, 5));
    for (const moment of [at(1, 0, 0), at(14, 20, 5), at(30, 23, 59)]) expect(momentOf(dateValue(moment), timeValue(moment))).toBe(moment);
  });

  it("are no moment while either is empty or not a date or a time", () => {
    for (const [date, time] of [["", "20:00"], ["2026-11-14", ""], ["", ""], ["14/11/2026", "20:00"], ["2026-11-14", "8pm"], ["2026-11-14", "20:00:30"]] as const) expect(momentOf(date, time)).toBeNaN();
  });
});
