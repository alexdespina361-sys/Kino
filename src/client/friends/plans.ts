import { PLAN_KEEP_AFTER_MS, planAsks, planDue, planTimeProblem, type InboxItem, type PlanItem } from "../../shared";
import { clockTime, dayWord } from "../account/time";
import { getLanguage, t } from "../i18n";

export type PlanStatus = "asks" | "agreed" | "due" | "declined" | "lapsed";

export function planStatus(item: PlanItem, now: number): PlanStatus {
  if (planAsks(item, now)) return "asks";
  if (planDue(item, now)) return "due";
  if (item.answer === "no") return "declined";
  return item.answer === "yes" && item.when > now ? "agreed" : "lapsed";
}

export const inboxToShow = (inbox: readonly InboxItem[], now: number): InboxItem[] => inbox.filter((item) => item.kind !== "plan" || planStatus(item, now) !== "lapsed");

export const duePlans = (inbox: readonly InboxItem[], now: number): PlanItem[] => inbox.filter((item): item is PlanItem => item.kind === "plan" && planDue(item, now));

export function nextPlanMoment(inbox: readonly InboxItem[], now: number): number | undefined {
  const moments = inbox.flatMap((item) => {
    if (item.kind !== "plan" || item.answer === "no") return [];
    return item.answer === undefined ? [item.when] : [item.when, item.when + PLAN_KEEP_AFTER_MS];
  });
  const ahead = moments.filter((at) => at > now);
  return ahead.length > 0 ? Math.min(...ahead) : undefined;
}

const upperFirst = (text: string): string => text.charAt(0).toLocaleUpperCase(getLanguage()) + text.slice(1);

export const whenText = (at: number, now: number): string => t("friends.planWhen", { day: dayWord(at, now, getLanguage()), time: clockTime(at, getLanguage()) });

export const whenLabel = (at: number, now: number): string => upperFirst(whenText(at, now));

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

export const PLAN_HOURS = [15, 18, 19, 20, 21, 22] as const;
export const PLAN_DAYS = 7;
const PREFERRED_HOURS = [20, 21, 22] as const;

export function planMoment(now: number, day: number, hour: number): number {
  const at = new Date(now);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + day, hour, 0, 0, 0).getTime();
}

export const planOffered = (at: number, now: number): boolean => planTimeProblem(at, now) === undefined;

export function defaultPlan(now: number): { day: number; hour: number } {
  for (const hour of PREFERRED_HOURS) if (planOffered(planMoment(now, 0, hour), now)) return { day: 0, hour };
  return { day: 1, hour: 20 };
}

const pad = (n: number): string => String(n).padStart(2, "0");
export const dateValue = (at: number): string => {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
export const timeValue = (at: number): string => {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function momentOf(date: string, time: string): number {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return Number.NaN;
  return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(clock[1]), Number(clock[2])).getTime();
}
