import type { SkipInterval, SkipTimes } from "./media";

export const SKIP_PARTS = ["recap", "intro", "outro"] as const;
export type SkipPart = (typeof SKIP_PARTS)[number];

const RULES: Record<SkipPart, { shortest: number; longest: number; startsBy?: number; startsWithin?: number; startsFrom?: number; startsInLast?: number }> = {
  intro: { shortest: 10, longest: 200, startsBy: 0.5, startsWithin: 900 },
  recap: { shortest: 5, longest: 300, startsBy: 0.35, startsWithin: 300 },
  outro: { shortest: 10, longest: 300, startsFrom: 0.5, startsInLast: 900 },
};

const SHORTEST_VIDEO = 120;
const PAST_THE_END = 2;

function interval(value: unknown): SkipInterval | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { start, end } = value as { start?: unknown; end?: unknown };
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  if (start < 0 || end <= start || end > 86_400) return undefined;
  return { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 };
}

export function skipTimesOf(raw: unknown): SkipTimes | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const found: SkipTimes = {};
  for (const part of SKIP_PARTS) {
    const its = interval((raw as Record<string, unknown>)[part]);
    if (its) found[part] = its;
  }
  return found.intro || found.recap || found.outro ? found : undefined;
}

export function mergeSkipTimes(first: SkipTimes | undefined, second: SkipTimes | undefined): SkipTimes | undefined {
  const merged: SkipTimes = {};
  for (const part of SKIP_PARTS) {
    const its = first?.[part] ?? second?.[part];
    if (its) merged[part] = its;
  }
  return merged.intro || merged.recap || merged.outro ? merged : undefined;
}

export function believableSkipTimes(skip: SkipTimes | undefined, length: number): SkipTimes | undefined {
  if (!skip || !Number.isFinite(length) || length < SHORTEST_VIDEO) return undefined;
  const kept: SkipTimes = {};
  for (const part of SKIP_PARTS) {
    const its = interval(skip[part]);
    if (!its) continue;
    const rule = RULES[part];
    if (its.end > length + PAST_THE_END) continue;
    const end = Math.min(its.end, length);
    const lasts = end - its.start;
    if (lasts < rule.shortest || lasts > rule.longest) continue;
    if (rule.startsBy !== undefined && its.start > rule.startsBy * length) continue;
    if (rule.startsWithin !== undefined && its.start > rule.startsWithin) continue;
    if (rule.startsFrom !== undefined && its.start < rule.startsFrom * length) continue;
    if (rule.startsInLast !== undefined && its.start < length - rule.startsInLast) continue;
    kept[part] = { start: its.start, end };
  }
  if (kept.recap && kept.intro && kept.recap.start < kept.intro.end && kept.intro.start < kept.recap.end) delete kept.recap;
  return kept.intro || kept.recap || kept.outro ? kept : undefined;
}
