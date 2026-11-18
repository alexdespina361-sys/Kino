import type { FeedbackArea, FeedbackDetailKey, FeedbackFrequency, FeedbackKind, FeedbackSeverity } from "../../shared";
import { FEEDBACK_KEY } from "../../shared";
import { readStorage, writeStorage } from "../shared/format";

const RECEIPTS_KEY = "kino.feedback.receipts";
const DRAFT_KEY = "kino.feedback.draft";
const MAX_RECEIPTS = 40;
export const DRAFT_DAYS = 14;

export interface Receipt {
  key: string;
  id: string;
  title: string;
  kind: FeedbackKind;
  at: number;
}

export interface Draft {
  kind: FeedbackKind;
  area: FeedbackArea;
  text: string;
  details: Partial<Record<FeedbackDetailKey, string>>;
  severity?: FeedbackSeverity | undefined;
  frequency?: FeedbackFrequency | undefined;
  at: number;
}

export function newKey(fill: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) => void crypto.getRandomValues(bytes)): string {
  const bytes = new Uint8Array(16);
  try {
    fill(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parse<T>(text: string | undefined, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readReceipts(): Receipt[] {
  const list = parse<unknown>(readStorage(RECEIPTS_KEY), []);
  if (!Array.isArray(list)) return [];
  return list.filter((each): each is Receipt => Boolean(each) && typeof each.key === "string" && FEEDBACK_KEY.test(each.key) && typeof each.id === "string" && typeof each.title === "string");
}

export function addReceipt(receipt: Receipt): void {
  const kept = readReceipts().filter((each) => each.key !== receipt.key);
  writeStorage(RECEIPTS_KEY, JSON.stringify([receipt, ...kept].slice(0, MAX_RECEIPTS)));
}

export function forgetReceipt(key: string): void {
  writeStorage(RECEIPTS_KEY, JSON.stringify(readReceipts().filter((each) => each.key !== key)));
}

export function readDraft(now: number = Date.now()): Draft | undefined {
  const draft = parse<Partial<Draft> | null>(readStorage(DRAFT_KEY), null);
  if (!draft || typeof draft.text !== "string" || typeof draft.at !== "number" || !draft.kind) return undefined;
  if (now - draft.at > DRAFT_DAYS * 86_400_000) return undefined;
  const hasWords = draft.text.trim() !== "" || Object.values(draft.details ?? {}).some((value) => typeof value === "string" && value.trim() !== "");
  return hasWords ? (draft as Draft) : undefined;
}

export function saveDraft(draft: Draft): void {
  const hasWords = draft.text.trim() !== "" || Object.values(draft.details).some((value) => value?.trim());
  writeStorage(DRAFT_KEY, hasWords ? JSON.stringify(draft) : null);
}

export function clearDraft(): void {
  writeStorage(DRAFT_KEY, null);
}
