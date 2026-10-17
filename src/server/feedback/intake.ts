import { randomBytes } from "node:crypto";
import {
  cleanText,
  feedbackTitle,
  FEEDBACK_DETAIL_KEYS,
  FEEDBACK_LIMITS,
  FeedbackAttachmentInputSchema,
  FeedbackContextSchema,
  type FeedbackAttachmentInput,
  type FeedbackContext,
  type FeedbackDetailKey,
  type FeedbackMime,
  type FeedbackRole,
} from "../../shared";
import type { FeedbackFile, NewReport } from "./store";

/** Why a file was not kept (the report was: nobody loses their words to a picture). */
export type RejectedReason = "bad_type" | "too_big" | "too_many" | "empty";
export interface Rejected {
  id: string;
  reason: RejectedReason;
}

export interface ReadFile {
  meta: Omit<FeedbackFile, "bytes">;
  data: Buffer;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** What a picture is by its first bytes, whatever its sender called it. */
function imageType(data: Buffer): "image/png" | "image/jpeg" | "image/webp" | undefined {
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG)) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

/** Text that a person could read: no zero bytes, and not a pile of broken characters. */
function textOf(data: Buffer): string | undefined {
  if (data.subarray(0, 8192).includes(0)) return undefined;
  const text = data.toString("utf8");
  const broken = text.split("�").length - 1;
  return broken > Math.max(2, text.length * 0.02) ? undefined : text;
}

const fileName = (name: string, fallback: string): string => cleanText(name, 80).replace(/[\\/:*?"<>|]+/g, "_").replace(/^\.+/, "") || fallback;

/**
 * The files of a request, checked by what they are and not by what they are called: a picture is a PNG, JPEG or WebP by its first bytes, a log is
 * text. What is not that, is too big, or is past the limits, is left out and said (`rejected`), and the rest is kept.
 */
export function readFiles(inputs: unknown[], taken: Set<string> = new Set(), usedBytes = 0): { files: ReadFile[]; rejected: Rejected[] } {
  const files: ReadFile[] = [];
  const rejected: Rejected[] = [];
  let total = usedBytes;
  for (const each of inputs) {
    const parsed = FeedbackAttachmentInputSchema.safeParse(each);
    if (!parsed.success) {
      const named = (each as { id?: unknown } | null)?.id;
      rejected.push({ id: typeof named === "string" ? named.slice(0, 24) : "", reason: "bad_type" });
      continue;
    }
    const input: FeedbackAttachmentInput = parsed.data;
    const reject = (reason: RejectedReason) => rejected.push({ id: input.id, reason });
    if (files.length >= FEEDBACK_LIMITS.attachments) {
      reject("too_many");
      continue;
    }
    const data = Buffer.from(input.data, "base64");
    if (data.length === 0) {
      reject("empty");
      continue;
    }
    const image = imageType(data);
    let mime: FeedbackMime;
    if (image) {
      mime = image;
    } else {
      const text = textOf(data);
      if (text === undefined) {
        reject("bad_type");
        continue;
      }
      mime = input.mime === "application/json" && isJson(text) ? "application/json" : "text/plain";
    }
    if (data.length > (image ? FEEDBACK_LIMITS.imageBytes : FEEDBACK_LIMITS.fileBytes) || total + data.length > FEEDBACK_LIMITS.totalBytes) {
      reject("too_big");
      continue;
    }
    total += data.length;
    // (The id the page gave is kept unless it is taken, so the page can tell which of its files was left out.)
    let id = input.id;
    while (taken.has(id)) id = randomBytes(6).toString("hex");
    taken.add(id);
    const role: FeedbackRole = image ? (input.role === "file" ? "photo" : input.role) : "file";
    const note = input.note ? cleanText(input.note, FEEDBACK_LIMITS.note) : "";
    files.push({
      meta: {
        id,
        name: fileName(input.name, image ? "picture" : "file"),
        mime,
        role,
        ...(note ? { note } : {}),
        ...(image && input.width && input.height ? { width: input.width, height: input.height } : {}),
      },
      data,
    });
  }
  return { files, rejected };
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Every text in the value without the characters that only break things (control, zero-width, direction marks). */
function cleanDeep<T>(value: T): T {
  if (typeof value === "string") return cleanText(value, value.length) as T;
  if (Array.isArray(value)) return value.map(cleanDeep) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, cleanDeep(each)])) as T;
  return value;
}

/**
 * What the page said about the device and the moment. A part that cannot be read is left out (and named in `dropped`) instead of the whole of it
 * or the report: the report is what matters.
 */
export function readContext(raw: unknown): { context: FeedbackContext | null; dropped: string[] } {
  if (raw === undefined || raw === null) return { context: null, dropped: [] };
  const whole = FeedbackContextSchema.safeParse(raw);
  if (whole.success) return { context: cleanDeep(whole.data), dropped: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) return { context: null, dropped: ["all"] };
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, schema] of Object.entries(FeedbackContextSchema.shape)) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const part = schema.safeParse(value);
    if (part.success) kept[key] = part.data;
    else dropped.push(key);
  }
  return { context: cleanDeep(kept as FeedbackContext), dropped };
}

/** The answers to the guided questions: only the questions there are, only text, only so much of it. */
export function readDetails(raw: unknown): Partial<Record<FeedbackDetailKey, string>> {
  const details: Partial<Record<FeedbackDetailKey, string>> = {};
  if (!raw || typeof raw !== "object") return details;
  for (const key of FEEDBACK_DETAIL_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const text = cleanText(value, FEEDBACK_LIMITS.detail);
    if (text) details[key] = text;
  }
  return details;
}

/** What a report's own words come to: the title (written, or made from the message, or from the first answer to a question) and the message, cleaned. */
export function readWords(input: { title?: string | undefined; message: string }, details: Record<string, string> = {}): { title: string; message: string } {
  const message = cleanText(input.message, FEEDBACK_LIMITS.text);
  const written = input.title ? cleanText(input.title, FEEDBACK_LIMITS.title) : "";
  return { title: feedbackTitle({ title: written, message: message || Object.values(details)[0] || "" }, "(no text)"), message };
}

export type Intake = Omit<NewReport, "key" | "accountId" | "files"> & { files: ReadFile[]; rejected: Rejected[] };

/** Whether there is anything to keep: words, or at least one file that was kept. */
export const isEmptyReport = (message: string, details: Record<string, string>, files: unknown[]): boolean => !message && Object.keys(details).length === 0 && files.length === 0;
