import type { ChatLine } from "../../shared";
import { FRESH_CHAT, type ChatState } from "./state";
import type { ChatReport, ChatSession } from "./useChat";

/** A session and a report as the views get them, for tests: nothing happens when they are used, and the test says what each press did. */
export function fakeSession(parts: Omit<Partial<ChatSession>, "state"> & { state?: Partial<ChatState> } = {}): ChatSession & { calls: string[] } {
  const calls: string[] = [];
  const { state, ...rest } = parts;
  return {
    state: { ...FRESH_CHAT, rev: 1, ...state },
    loaded: true,
    ended: null,
    problem: null,
    sending: false,
    send: async (text) => (calls.push(`send:${text}`), true),
    takeBack: async (id) => void calls.push(`takeBack:${id}`),
    setMuted: async (muted) => void calls.push(`mute:${muted}`),
    settle: () => void calls.push("settle"),
    ...rest,
    calls,
  };
}

export function fakeReport(parts: Partial<ChatReport> = {}): ChatReport & { calls: string[] } {
  const calls: string[] = [];
  return {
    stage: "closed",
    preview: null,
    problem: null,
    start: () => void calls.push("start"),
    confirm: () => void calls.push("confirm"),
    cancel: () => void calls.push("cancel"),
    ...parts,
    calls,
  };
}

export const line = (id: number, mine: boolean, text = `message ${id}`, at = Date.UTC(2026, 9, 18, 12, id)): ChatLine => ({ id, mine, text, at });

/** The opening tag of the element with this test id, or undefined: to ask what attributes it has. */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const tagOf = (html: string, testId: string): string | undefined => new RegExp(`<[^>]*data-testid="${escapeRegExp(testId)}"[^>]*>`).exec(html)?.[0];
export const has = (html: string, testId: string): boolean => tagOf(html, testId) !== undefined;
export const count = (html: string, testId: string): number => html.split(`data-testid="${testId}"`).length - 1;
