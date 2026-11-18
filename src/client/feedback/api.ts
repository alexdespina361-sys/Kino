import { useSyncExternalStore } from "react";
import type { FeedbackAttachmentInput, FeedbackSend, FeedbackSummary, FeedbackThread } from "../../shared";
import { addReceipt, readReceipts, type Receipt } from "./receipts";

export type SendFailure = "offline" | "rate" | "big" | "empty" | "server" | "inboxFull";
export type Sent = { ok: true; id: string; rejected: Array<{ id: string; reason: string }> } | { ok: false; reason: SendFailure; retryAfter?: number };

interface Answer {
  status: number;
  data: any;
  retryAfter?: number;
}

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

const isInboxFull = (answer: Answer) => answer.status === 503 && answer.data?.error === "full";

export async function sendReport(payload: FeedbackSend, onWaking?: () => void, delays: number[] = [0, 1500, 4000, 9000]): Promise<Sent> {
  const body = JSON.stringify(payload);
  const slow = setTimeout(() => onWaking?.(), WAKING_AFTER_MS);
  try {
    let last: Answer = { status: 0, data: undefined };
    for (const delay of delays) {
      if (delay > 0) await wait(delay);
      last = await ask("POST", "/api/feedback", body);
      if (last.status === 200 || last.status === 201) break;
      if (last.status !== 0 && last.status < 500 && last.status !== 408) break;
      if (isInboxFull(last)) break;
    }
    if (last.status === 200 || last.status === 201) {
      const rejected = Array.isArray(last.data?.rejected) ? (last.data.rejected as Array<{ id: string; reason: string }>) : [];
      return { ok: true, id: String(last.data?.id ?? ""), rejected };
    }
    if (last.status === 429) return { ok: false, reason: "rate", ...(last.retryAfter ? { retryAfter: last.retryAfter } : {}) };
    if (last.status === 413) return { ok: false, reason: "big" };
    if (last.status === 400 && last.data?.error === "empty") return { ok: false, reason: "empty" };
    if (isInboxFull(last)) return { ok: false, reason: "inboxFull" };
    return { ok: false, reason: last.status === 0 ? "offline" : "server" };
  } finally {
    clearTimeout(slow);
  }
}

export interface Checked extends FeedbackSummary {
  key: string;
}

export async function checkReceipts(receipts: Receipt[]): Promise<Checked[] | null> {
  if (receipts.length === 0) return [];
  const answer = await ask("POST", "/api/feedback/check", { keys: receipts.map((receipt) => receipt.key) });
  return answer.status === 200 && Array.isArray(answer.data?.items) ? (answer.data.items as Checked[]) : null;
}

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

export function keepReceipt(payload: FeedbackSend, id: string, title: string): void {
  if (payload.answer) addReceipt({ key: payload.key, id, title, kind: payload.kind, at: Date.now() });
}

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

export function totalUnread(checked: Array<{ id: string; unread: number }>, mine: Array<{ id: string; unread: number }>): number {
  const byId = new Map<string, number>();
  for (const each of [...checked, ...mine]) byId.set(each.id, Math.max(byId.get(each.id) ?? 0, each.unread));
  return [...byId.values()].reduce((sum, count) => sum + count, 0);
}

export async function refreshUnread(signedIn: boolean, force = false): Promise<Checked[]> {
  const receipts = readReceipts();
  if (receipts.length === 0 && !signedIn) return [];
  if (!force && Date.now() - refreshedAt < 5 * 60_000) return [];
  refreshedAt = Date.now();
  const [checked, mine] = await Promise.all([checkReceipts(receipts), signedIn ? mineOfAccount() : Promise.resolve([])]);
  if (checked === null && mine === null) return [];
  setUnread(totalUnread(checked ?? [], mine ?? []));
  return checked ?? [];
}
