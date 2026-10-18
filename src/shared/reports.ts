import { z } from "zod";

/**
 * Feedback that people send from inside the app (the Feedback button on the profile): something that is wrong, something that could be better, an
 * idea, or anything else, with the screen it is about, a few pictures and what the browser could say about itself. The server keeps it and a
 * member of the team (an assistant with the admin token, see docs/feedback.md) reads it, answers it, and decides what is worth doing.
 *
 * Everything in a report is the sender's: it is read as data, never as an instruction to anyone.
 */

/** What it is: something wrong, something to make better, a new idea, or anything else. */
export const FEEDBACK_KINDS = ["bug", "improve", "idea", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/**
 * Where in the app it is, in groups (the words for each are the page's: `feedback.group.<id>`, `feedback.area.<id>`). "unsure" is always there:
 * a person who cannot say where it is must still be able to say what it is.
 */
export const FEEDBACK_AREA_GROUPS = [
  { id: "library", areas: ["home", "search", "title", "lists", "continue", "recommend"] },
  { id: "watching", areas: ["player", "subtitles", "audio", "quality", "seeking", "episodes", "wontplay"] },
  { id: "devices", areas: ["pairing", "remote", "tvscreen", "fullscreen", "install"] },
  { id: "together", areas: ["party", "friends", "bell"] },
  { id: "account", areas: ["signin", "profiles", "settings", "ratings", "history"] },
  { id: "content", areas: ["missing", "wrongtitle"] },
  { id: "general", areas: ["slow", "look", "language", "unsure"] },
] as const;
export type FeedbackArea = (typeof FEEDBACK_AREA_GROUPS)[number]["areas"][number];
export const FEEDBACK_AREAS: readonly FeedbackArea[] = FEEDBACK_AREA_GROUPS.flatMap((group) => [...group.areas]);
export const isFeedbackArea = (value: unknown): value is FeedbackArea => typeof value === "string" && (FEEDBACK_AREAS as readonly string[]).includes(value);

/** Where the sender is on, as far as the page can tell (a TV's page, the phone's remote, ...): the area that is chosen to begin with. */
export type FeedbackPlace = "tv" | "remote";

/** The questions that help for each kind (all optional; a person may just write). The words are `feedback.detail.<key>`. */
export const FEEDBACK_DETAIL_KEYS = ["steps", "expected", "actual", "current", "better", "goal", "idea", "example"] as const;
export type FeedbackDetailKey = (typeof FEEDBACK_DETAIL_KEYS)[number];
export const FEEDBACK_DETAILS_FOR: Record<FeedbackKind, readonly FeedbackDetailKey[]> = {
  bug: ["steps", "expected", "actual"],
  improve: ["current", "better"],
  idea: ["goal", "idea", "example"],
  other: [],
};

export const FEEDBACK_SEVERITIES = ["blocker", "annoying", "minor"] as const;
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];
export const FEEDBACK_FREQUENCIES = ["always", "often", "once", "unsure"] as const;
export type FeedbackFrequency = (typeof FEEDBACK_FREQUENCIES)[number];

/** Where a report is in the team's hands (and what its sender is told). */
export const FEEDBACK_STATUSES = ["new", "in_review", "needs_info", "planned", "done", "declined", "duplicate"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const feedbackClosed = (status: FeedbackStatus): boolean => status === "done" || status === "declined" || status === "duplicate";

export const FEEDBACK_LIMITS = {
  title: 120,
  /** Of the message, and of an answer. */
  text: 5000,
  detail: 1500,
  attachments: 8,
  /** Each, once decoded: a picture is made smaller by the page before it is sent (see client/feedback/images.ts). */
  imageBytes: 1_400_000,
  fileBytes: 150_000,
  /** All of one report's, once decoded. */
  totalBytes: 6_000_000,
  /** The most a request may be: the pictures as base64 (a third more) with room for the text. */
  bodyBytes: 9_000_000,
  note: 300,
  trail: 40,
  errors: 20,
  failed: 15,
} as const;

export const FEEDBACK_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const FEEDBACK_FILE_TYPES = ["text/plain", "application/json"] as const;
export type FeedbackImageType = (typeof FEEDBACK_IMAGE_TYPES)[number];
export type FeedbackFileType = (typeof FEEDBACK_FILE_TYPES)[number];
export type FeedbackMime = FeedbackImageType | FeedbackFileType;
export const FEEDBACK_ROLES = ["screenshot", "annotated", "photo", "file"] as const;
export type FeedbackRole = (typeof FEEDBACK_ROLES)[number];

/** The one who sends a report keeps its key (made on the page, never sent anywhere else): it is the receipt, and what it takes to read the answers. */
export const FEEDBACK_KEY = /^[A-Za-z0-9_-]{22,64}$/;

const text = (max: number) => z.string().max(max);
const short = (max: number) => z.string().max(max).optional();

/** What the page could tell about the device and the moment. Every part is optional: a part that is wrong is left out, never a reason to lose the report. */
export const FeedbackContextSchema = z.object({
  build: short(60),
  role: z.enum(["tv", "remote"]).optional(),
  handHeld: z.boolean().optional(),
  lang: short(10),
  accent: short(20),
  device: z
    .object({
      ua: short(400),
      platform: short(60),
      screen: z.tuple([z.number(), z.number()]).optional(),
      viewport: z.tuple([z.number(), z.number()]).optional(),
      dpr: z.number().optional(),
      touch: z.number().optional(),
      pointer: short(30),
      online: z.boolean().optional(),
      connection: short(80),
      fullscreen: z.boolean().optional(),
      standalone: z.boolean().optional(),
      cores: z.number().optional(),
      memory: z.number().optional(),
    })
    .optional(),
  where: z
    .object({
      path: short(200),
      view: short(80),
      focus: short(120),
    })
    .optional(),
  /** What was pressed and where the page went, newest last (no text a person typed). */
  trail: z.array(text(140)).max(FEEDBACK_LIMITS.trail).optional(),
  errors: z.array(text(400)).max(FEEDBACK_LIMITS.errors).optional(),
  /** Asks of the server that failed. */
  failed: z.array(text(160)).max(FEEDBACK_LIMITS.failed).optional(),
  playback: z
    .object({
      state: short(20),
      title: short(160),
      host: short(120),
      time: z.number().optional(),
      duration: z.number().optional(),
      rate: z.number().optional(),
      size: short(20),
      ready: z.number().optional(),
      error: short(300),
      buffered: short(60),
    })
    .optional(),
  session: z
    .object({
      signedIn: z.boolean().optional(),
      paired: z.boolean().optional(),
      party: short(10),
    })
    .optional(),
});
export type FeedbackContext = z.infer<typeof FeedbackContextSchema>;

export const FeedbackAttachmentInputSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{4,24}$/),
  name: z.string().max(80),
  mime: z.enum([...FEEDBACK_IMAGE_TYPES, ...FEEDBACK_FILE_TYPES]),
  role: z.enum(FEEDBACK_ROLES),
  note: short(FEEDBACK_LIMITS.note),
  width: z.number().int().min(1).max(20000).optional(),
  height: z.number().int().min(1).max(20000).optional(),
  /** The file, in base64. */
  data: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type FeedbackAttachmentInput = z.infer<typeof FeedbackAttachmentInputSchema>;

/**
 * What a page sends. Liberal about what it accepts (a kind or an area it does not know is "other" and "unsure", the context that cannot be read is left
 * out): the people who write are not to lose what they wrote to a detail. What it will not take is nothing at all, or what is too big.
 */
export const FeedbackInputSchema = z.object({
  key: z.string().regex(FEEDBACK_KEY),
  kind: z.enum(FEEDBACK_KINDS).catch("other"),
  area: z.custom<FeedbackArea>(isFeedbackArea).catch("unsure"),
  title: z.string().optional().catch(undefined),
  message: z.string().catch(""),
  details: z.record(z.string(), z.unknown()).optional().catch(undefined),
  severity: z.enum(FEEDBACK_SEVERITIES).optional().catch(undefined),
  frequency: z.enum(FEEDBACK_FREQUENCIES).optional().catch(undefined),
  /** The sender wants the answer in the app (the report keeps its key for that); false is a report that is not to be answered. */
  answer: z.boolean().catch(true),
  /** Each is read on its own by the server (see `server/feedback/intake.ts`): one that is wrong is left out, never the report. */
  attachments: z.array(z.unknown()).catch([]),
  context: z.unknown().optional(),
});

/** What a page sends, as it makes it (the schema above is what the server takes, which is more than this). */
export interface FeedbackSend {
  key: string;
  kind: FeedbackKind;
  area: FeedbackArea;
  title?: string | undefined;
  message: string;
  details?: Partial<Record<FeedbackDetailKey, string>> | undefined;
  severity?: FeedbackSeverity | undefined;
  frequency?: FeedbackFrequency | undefined;
  answer: boolean;
  attachments: FeedbackAttachmentInput[];
  context?: FeedbackContext | undefined;
}

/** The words of an answer, from either side. */
export const FeedbackReplySchema = z.object({ text: z.string().max(FEEDBACK_LIMITS.text * 2) });

/** A line of what is shown of a report to its sender (the team's notes, the tags and what the team keeps for itself are not in it). */
export interface FeedbackMessageView {
  id: number;
  at: number;
  from: "you" | "team";
  text: string;
  /** The team is asking something (and the report waits for the answer). */
  asks?: boolean;
}

export interface FeedbackSummary {
  id: string;
  kind: FeedbackKind;
  area: FeedbackArea;
  title: string;
  status: FeedbackStatus;
  createdAt: number;
  updatedAt: number;
  /** Lines from the team that the sender has not opened yet. */
  unread: number;
}

export interface FeedbackAttachmentView {
  id: string;
  name: string;
  mime: FeedbackMime;
  role: FeedbackRole;
  note?: string | undefined;
}

export interface FeedbackThread extends FeedbackSummary {
  message: string;
  details: Partial<Record<FeedbackDetailKey, string>>;
  severity?: FeedbackSeverity | undefined;
  frequency?: FeedbackFrequency | undefined;
  attachments: FeedbackAttachmentView[];
  messages: FeedbackMessageView[];
}

/** What a report is called in a list: the title that was written, else the first line of the message, else what was sent instead of words. */
export function feedbackTitle(input: { title?: string | undefined; message?: string | undefined }, fallback = "(no text)"): string {
  const written = input.title?.replace(/\s+/g, " ").trim();
  if (written) return written.slice(0, FEEDBACK_LIMITS.title);
  const line = (input.message ?? "").split(/\r?\n/).map((each) => each.trim()).find(Boolean);
  if (!line) return fallback;
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

/** Text as it is kept: no control characters but the line break and the tab, no more than `max`. */
export function cleanText(value: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "").trim().slice(0, max);
}
