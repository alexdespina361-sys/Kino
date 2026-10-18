import { useSyncExternalStore } from "react";
import type { FeedbackAttachmentInput, FeedbackSend, FeedbackSummary, FeedbackThread } from "../../shared";
import { addReceipt, readReceipts, type Receipt } from "./receipts";

/** The server's side of the feedback, asked for with the browser's own cookie (so a signed-in account is known) and a receipt key (so a report is known). */

export type SendFailure = "offline" | "rate" | "big" | "empty" | "server";
export type Sent = { ok: true; id: string; rejected: Array<{ id: string; reason: string }> } | { ok: false; reason: SendFailure; retryAfter?: number };

interface Answer {
  status: number;
  data: any;
  retryAfter?: number;
}

/** A free host that has slept takes up to a minute to wake: an ask waits this long before it is given up. */
const ASK_TIMEOUT_MS = 75_000;
const WAKING_AFTER_MS = 6_000;

async function ask(method: "GET" | "POST", path: string, body?: unknown): Promise<Answer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      signal: controller.signal,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
    const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
    const retry = Number(response.headers.get("retry-after"));
    return { status: response.status, data, ...(retry > 0 ? { retryAfter: retry } : {}) };
  } catch {
    return { status: 0, data: undefined };
  } finally {
    clearTimeout(timer);
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends a report. The key in it is the report's name on the server, so asking again after an answer that never came is safe (the server keeps one
 * report for a key): a bad connection, a server that is waking up or one that is just then restarting are tried again, a few times, before the person
 * is told. `onWaking` is called when it is taking long (the server is probably waking up).
 */
export async function sendReport(payload: FeedbackSend, onWaking?: () => void, delays: number[] = [0, 1500, 4000, 9000]): Promise<Sent> {
  const body = JSON.stringify(payload);
  const slow = setTimeout(() => onWaking?.(), WAKING_AFTER_MS);
  try {
    let last: Answer = { status: 0, data: undefined };
    for (const delay of delays) {
      if (delay > 0) await wait(delay);
      last = await ask("POST", "/api/feedback", body);
      if (last.status === 200 || last.status === 201) break;
      if (last.status !== 0 && last.status < 500 && last.status !== 408) break; // (a no that asking again will not change)
    }
    if (last.status === 200 || last.status === 201) {
      const rejected = Array.isArray(last.data?.rejected) ? (last.data.rejected as Array<{ id: string; reason: string }>) : [];
      return { ok: true, id: String(last.data?.id ?? ""), rejected };
    }
    if (last.status === 429) return { ok: false, reason: "rate", ...(last.retryAfter ? { retryAfter: last.retryAfter } : {}) };
    if (last.status === 413) return { ok: false, reason: "big" };
    if (last.status === 400 && last.data?.error === "empty") return { ok: false, reason: "empty" };
    return { ok: false, reason: last.status === 0 ? "offline" : "server" };
  } finally {
    clearTimeout(slow);
  }
}

export interface Checked extends FeedbackSummary {
  key: string;
}

/** What became of the reports this browser holds receipts for (those the server no longer has are not in the answer); null when the server could not be asked. */
export async function checkReceipts(receipts: Receipt[]): Promise<Checked[] | null> {
  if (receipts.length === 0) return [];
  const answer = await ask("POST", "/api/feedback/check", { keys: receipts.map((receipt) => receipt.key) });
  return answer.status === 200 && Array.isArray(answer.data?.items) ? (answer.data.items as Checked[]) : null;
}

/** The reports of the account that is signed in (none when nobody is); null when the server could not be asked. */
export async function mineOfAccount(): Promise<FeedbackSummary[] | null> {
  const answer = await ask("GET", "/api/feedback/mine");
  return answer.status === 200 && Array.isArray(answer.data?.items) ? (answer.data.items as FeedbackSummary[]) : null;
}

export interface Who {
  key?: string;
  id?: string;
}

export async function openThread(who: Who): Promise<FeedbackThread | null> {
  const answer = await ask("POST", "/api/feedback/open", who);
  return answer.status === 200 ? (answer.data as FeedbackThread) : null;
}

export type Replied = { ok: true; rejected: Array<{ id: string; reason: string }> } | { ok: false; reason: SendFailure | "full" };

export async function sendReply(who: Who, text: string, attachments: FeedbackAttachmentInput[] = []): Promise<Replied> {
  const answer = await ask("POST", "/api/feedback/reply", { ...who, text, attachments });
  if (answer.status === 201) return { ok: true, rejected: Array.isArray(answer.data?.rejected) ? answer.data.rejected : [] };
  if (answer.status === 409) return { ok: false, reason: "full" };
  if (answer.status === 429) return { ok: false, reason: "rate" };
  if (answer.status === 413) return { ok: false, reason: "big" };
  if (answer.status === 400) return { ok: false, reason: "empty" };
  return { ok: false, reason: answer.status === 0 ? "offline" : "server" };
}

/** Keeps the receipt of a report that went through. */
export function keepReceipt(payload: FeedbackSend, id: string, title: string): void {
  if (payload.answer) addReceipt({ key: payload.key, id, title, kind: payload.kind, at: Date.now() });
}

/* ------------------------------ "you have an answer" ------------------------------ */

/** How many lines from the team the person has not read, over the receipts of this browser and the signed-in account's reports. */
let unread = 0;
let refreshedAt = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const useUnreadFeedback = (): number => useSyncExternalStore(subscribe, () => unread, () => 0);

export function setUnread(count: number): void {
  if (count === unread) return;
  unread = count;
  listeners.forEach((listener) => listener());
}

/** The same report may be in both lists (a receipt, and the account's own): it counts once. */
export function totalUnread(checked: Array<{ id: string; unread: number }>, mine: Array<{ id: string; unread: number }>): number {
  const byId = new Map<string, number>();
  for (const each of [...checked, ...mine]) byId.set(each.id, Math.max(byId.get(each.id) ?? 0, each.unread));
  return [...byId.values()].reduce((sum, count) => sum + count, 0);
}

/**
 * Asks whether there is an answer to what this browser sent (at most once in a few minutes; nothing is asked when nothing was sent and nobody
 * is signed in). Called when a button that leads to the feedback is on screen, never on a timer: a page that asked on a timer would keep a sleeping
 * host awake.
 */
export async function refreshUnread(signedIn: boolean, force = false): Promise<Checked[]> {
  const receipts = readReceipts();
  if (receipts.length === 0 && !signedIn) return [];
  if (!force && Date.now() - refreshedAt < 5 * 60_000) return [];
  refreshedAt = Date.now();
  const [checked, mine] = await Promise.all([checkReceipts(receipts), signedIn ? mineOfAccount() : Promise.resolve([])]);
  if (checked === null && mine === null) return []; // (the server could not be asked: what was known stays)
  setUnread(totalUnread(checked ?? [], mine ?? []));
  return checked ?? [];
}
