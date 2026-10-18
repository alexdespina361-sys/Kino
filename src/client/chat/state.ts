import { CHAT_KEEP_MAX, CHAT_KEEP_MS, CHAT_TEXT_MAX, type ChatLine, type ChatThread } from "../../shared";
import { ApiError } from "../account/api";

/** What can go wrong with a chat, in the few words the views know how to say. */
export type ChatProblem = "offline" | "rate_limited" | "chat_off" | "friends_off" | "not_friends" | "too_long" | "empty" | "gone" | "changed" | "other";

const PROBLEMS: readonly ChatProblem[] = ["offline", "rate_limited", "chat_off", "friends_off", "not_friends", "too_long", "empty", "gone", "changed"];

/** What a failed call comes to: the server's word when the views have a sentence for it, else "other". */
export function problemOf(error: unknown): ChatProblem {
  const code = error instanceof ApiError ? error.code : "";
  return PROBLEMS.find((problem) => problem === code) ?? "other";
}

/** The chat can't go on at all: the friend is no friend any more, or friends are off. Asking again would only be told the same. */
export const endsChat = (problem: ChatProblem): problem is "not_friends" | "friends_off" => problem === "not_friends" || problem === "friends_off";

/** The chat as the page has it. `rev` is null until the first answer. */
export interface ChatState {
  rev: number | null;
  /** Whether the friend takes messages. */
  open: boolean;
  /** Whether new messages from the friend are muted (for this profile only). */
  muted: boolean;
  /** Oldest first. */
  lines: readonly ChatLine[];
}

export const FRESH_CHAT: ChatState = { rev: null, open: true, muted: false, lines: [] };

/**
 * The chat after an answer. An answer older than what the page has (it was slow, and a later one came first) is ignored. An answer without
 * messages means "still at the revision you have". `keepMuted`: a mute is on its way or has just been answered, so a reading that started
 * before it must not put the old state back.
 */
export function applyThread(state: ChatState, answer: ChatThread, keepMuted = false): ChatState {
  if (state.rev !== null && answer.rev < state.rev) return state;
  return { rev: answer.rev, open: answer.open, muted: keepMuted ? state.muted : answer.muted, lines: answer.lines ?? state.lines };
}

/** The newest message of one's own, or undefined. */
export function lastOwn(lines: readonly ChatLine[]): ChatLine | undefined {
  for (let at = lines.length - 1; at >= 0; at--) if (lines[at]!.mine) return lines[at];
  return undefined;
}

const DAY = 86_400_000;
const startOf = (at: number) => {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};
/** The date formats follow the language of the site, with British English for English (as the rest of the site does: the day comes first). */
const localeOf = (language: string) => (language === "en" ? "en-GB" : language);

/** The hour of a message ("09:05") in the language of the site. Empty for a time that is not one. */
export function stampOf(at: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(localeOf(language), { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
  } catch {
    return "";
  }
}

/** The day a message was written, for the line that begins a day: "today" and "yesterday" in words, an older one as "14 Oct". Empty for a time that is not one. */
export function dayOf(at: number, now: number, language: string): string {
  try {
    const ago = Math.round((startOf(at) - startOf(now)) / DAY);
    if (ago === 0 || ago === -1) return new Intl.RelativeTimeFormat(localeOf(language), { numeric: "auto" }).format(ago, "day");
    return new Intl.DateTimeFormat(localeOf(language), { day: "numeric", month: "short" }).format(new Date(at));
  } catch {
    return "";
  }
}

/** Whether a message begins a new day (the first one does), for the line that says which. */
export function startsDay(lines: readonly ChatLine[], index: number): boolean {
  const line = lines[index];
  if (!line) return false;
  const before = lines[index - 1];
  return !before || new Date(before.at).toDateString() !== new Date(line.at).toDateString();
}

/** The numbers the views say in words: the limits of shared/chat.ts. */
export const CHAT_FACTS = { messages: CHAT_KEEP_MAX, days: Math.round(CHAT_KEEP_MS / 86_400_000), max: CHAT_TEXT_MAX } as const;
