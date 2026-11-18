import { CHAT_KEEP_MAX, CHAT_KEEP_MS, CHAT_TEXT_MAX, type ChatLine, type ChatReactionsNow, type ChatThread } from "../../shared";
import { ApiError } from "../account/api";

export type ChatProblem = "offline" | "rate_limited" | "chat_off" | "friends_off" | "not_friends" | "too_long" | "empty" | "gone" | "changed" | "other";

const PROBLEMS: readonly ChatProblem[] = ["offline", "rate_limited", "chat_off", "friends_off", "not_friends", "too_long", "empty", "gone", "changed"];

export function problemOf(error: unknown): ChatProblem {
  const code = error instanceof ApiError ? error.code : "";
  return PROBLEMS.find((problem) => problem === code) ?? "other";
}

export const endsChat = (problem: ChatProblem): problem is "not_friends" | "friends_off" => problem === "not_friends" || problem === "friends_off";

export interface ChatState {
  rev: number | null;
  open: boolean;
  muted: boolean;
  lines: readonly ChatLine[];
  theirSeen: number;
  theirGot: number;
}

export const FRESH_CHAT: ChatState = { rev: null, open: true, muted: false, lines: [], theirSeen: 0, theirGot: 0 };

export const ticksOf = (state: Pick<ChatState, "theirSeen" | "theirGot">, id: number): 0 | 1 | 2 => (id <= state.theirSeen ? 2 : id <= state.theirGot ? 1 : 0);

export function applyThread(state: ChatState, answer: ChatThread, keepMuted = false, older = false): ChatState {
  if (state.rev !== null && (answer.rev < state.rev || (answer.rev === state.rev && older))) return state;
  const lines = answer.lines ?? (answer.reactions ? withReactions(state.lines, answer.reactions) : state.lines);
  const theirSeen = Math.max(state.theirSeen, answer.theirSeen ?? 0);
  const theirGot = Math.max(state.theirGot, theirSeen, answer.theirGot ?? 0);
  return { rev: answer.rev, open: answer.open, muted: keepMuted ? state.muted : answer.muted, lines, theirSeen, theirGot };
}

function withReactions(lines: readonly ChatLine[], now: readonly ChatReactionsNow[]): readonly ChatLine[] {
  if (now.length === 0) return lines;
  const byId = new Map(now.map((each) => [each.id, each]));
  return lines.map((line) => {
    const changed = byId.get(line.id);
    if (!changed) return line;
    const { myReaction: _mine, theirReaction: _theirs, ...rest } = line;
    return { ...rest, ...(changed.myReaction ? { myReaction: changed.myReaction } : {}), ...(changed.theirReaction ? { theirReaction: changed.theirReaction } : {}) };
  });
}

export function lastOwn(lines: readonly ChatLine[]): ChatLine | undefined {
  for (let at = lines.length - 1; at >= 0; at--) if (lines[at]!.mine) return lines[at];
  return undefined;
}

const DAY = 86_400_000;
const startOf = (at: number) => {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};
const localeOf = (language: string) => (language === "en" ? "en-GB" : language);

export function stampOf(at: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(localeOf(language), { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
  } catch {
    return "";
  }
}

export function dayOf(at: number, now: number, language: string): string {
  try {
    const ago = Math.round((startOf(at) - startOf(now)) / DAY);
    if (ago === 0 || ago === -1) return new Intl.RelativeTimeFormat(localeOf(language), { numeric: "auto" }).format(ago, "day");
    const other = new Date(at).getFullYear() !== new Date(now).getFullYear();
    return new Intl.DateTimeFormat(localeOf(language), { day: "numeric", month: "short", ...(other ? { year: "numeric" } : {}) }).format(new Date(at));
  } catch {
    return "";
  }
}

export function startsDay(lines: readonly ChatLine[], index: number): boolean {
  const line = lines[index];
  if (!line) return false;
  const before = lines[index - 1];
  return !before || new Date(before.at).toDateString() !== new Date(line.at).toDateString();
}

export const CHAT_FACTS = { messages: CHAT_KEEP_MAX, days: Math.round(CHAT_KEEP_MS / 86_400_000), max: CHAT_TEXT_MAX } as const;
