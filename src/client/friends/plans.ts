import { PLAN_KEEP_AFTER_MS, planAsks, planDue, planTimeProblem, type InboxItem, type PlanItem } from "../../shared";
import { clockTime, dayWord } from "../account/time";
import { getLanguage, t } from "../i18n";

/**
 * Plans to watch together as a screen shows them: where a plan stands now, what it says, when something about it changes by itself, and the
 * days and hours the TV offers to plan on. Pure (but for the words), so what appears when can be tested without a screen.
 *
 * A plan is an item of the inbox (see `PlanSchema`) in one of five states. It asks for an answer; it is on (both said yes, the time has not come);
 * it is due (on, and its time has come: for a little while a screen says so and offers a party); it was turned down (the news a friend's no is);
 * or it is over (nobody answered by its time, or it was due a while ago): a screen leaves it out, though the server may not have let go of it yet.
 */
export type PlanStatus = "asks" | "agreed" | "due" | "declined" | "lapsed";

export function planStatus(item: PlanItem, now: number): PlanStatus {
  if (planAsks(item, now)) return "asks";
  if (planDue(item, now)) return "due";
  if (item.answer === "no") return "declined";
  return item.answer === "yes" && item.when > now ? "agreed" : "lapsed";
}

/** The inbox as a screen shows it: without the plans that are over. */
export const inboxToShow = (inbox: readonly InboxItem[], now: number): InboxItem[] => inbox.filter((item) => item.kind !== "plan" || planStatus(item, now) !== "lapsed");

/** The plans that are due. */
export const duePlans = (inbox: readonly InboxItem[], now: number): PlanItem[] => inbox.filter((item): item is PlanItem => item.kind === "plan" && planDue(item, now));

/** The next moment something about a plan changes by itself (it asks no more, it is due, it is over), so that a screen that stays open can look again then. */
export function nextPlanMoment(inbox: readonly InboxItem[], now: number): number | undefined {
  const moments = inbox.flatMap((item) => {
    if (item.kind !== "plan" || item.answer === "no") return [];
    return item.answer === undefined ? [item.when] : [item.when, item.when + PLAN_KEEP_AFTER_MS];
  });
  const ahead = moments.filter((at) => at > now);
  return ahead.length > 0 ? Math.min(...ahead) : undefined;
}

/* ------------------------------ what a plan says ------------------------------ */

const upperFirst = (text: string): string => text.charAt(0).toLocaleUpperCase(getLanguage()) + text.slice(1);

/** "tomorrow at 20:00", "Saturday at 20:00": when something is planned, in the viewer's own time and words. */
export const whenText = (at: number, now: number): string => t("friends.planWhen", { day: dayWord(at, now, getLanguage()), time: clockTime(at, getLanguage()) });

/** The same to start a line with: "Tomorrow at 20:00". */
export const whenLabel = (at: number, now: number): string => upperFirst(whenText(at, now));

/** A plan as a line of two: what it is, and when (with the few words that came with it, if there are any). */
export function planLines(item: PlanItem, from: string, now: number): { heading: string; detail: string } {
  const when = whenLabel(item.when, now);
  const detail = item.note ? `${when} · ${item.note}` : when;
  switch (planStatus(item, now)) {
    case "asks":
      return { heading: t("friends.planOf", { name: from }), detail };
    case "due":
      return { heading: t("friends.planDue", { name: from }), detail };
    case "declined":
      return { heading: t("friends.planDeclined", { name: from }), detail: when };
    default:
      return { heading: t("friends.planAgreed", { name: from }), detail };
  }
}

/* ------------------------------ choosing a time ------------------------------ */

/** The hours of the day the TV offers (the evening, mostly), and how many days: today and the six after it. */
export const PLAN_HOURS = [15, 18, 19, 20, 21, 22] as const;
export const PLAN_DAYS = 7;
/** Which hour to start on, the first that is still ahead (an earlier hour would be gone by the time 20:00 is). */
const PREFERRED_HOURS = [20, 21, 22] as const;

/** `hour` o'clock, `day` days after the day `now` falls on, by the viewer's own clock. */
export function planMoment(now: number, day: number, hour: number): number {
  const at = new Date(now);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + day, hour, 0, 0, 0).getTime();
}

/** Whether a moment can be put as a plan (not less than five minutes ahead, not more than thirty days). */
export const planOffered = (at: number, now: number): boolean => planTimeProblem(at, now) === undefined;

/** What the choice of a day and an hour starts on: 20:00, or the next of 21:00 and 22:00 that is still ahead today, else 20:00 tomorrow. */
export function defaultPlan(now: number): { day: number; hour: number } {
  for (const hour of PREFERRED_HOURS) if (planOffered(planMoment(now, 0, hour), now)) return { day: 0, hour };
  return { day: 1, hour: 20 };
}

/** A moment as the value of a date input ("2026-11-14") and of a time input ("20:00"), by the viewer's own clock. */
const pad = (n: number): string => String(n).padStart(2, "0");
export const dateValue = (at: number): string => {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
export const timeValue = (at: number): string => {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** The moment a date input and a time input name together, by the viewer's own clock; NaN while either is empty or not a date or a time. */
export function momentOf(date: string, time: string): number {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return Number.NaN;
  return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(clock[1]), Number(clock[2])).getTime();
}
