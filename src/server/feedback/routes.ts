import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  cleanText,
  FEEDBACK_AREAS,
  FEEDBACK_DETAIL_KEYS,
  FEEDBACK_KEY,
  FEEDBACK_KINDS,
  FEEDBACK_LIMITS,
  FEEDBACK_STATUSES,
  FeedbackInputSchema,
  type FeedbackArea,
  type FeedbackAttachmentView,
  type FeedbackKind,
  type FeedbackMessageView,
  type FeedbackStatus,
  type FeedbackSummary,
  type FeedbackThread,
} from "../../shared";
import { RateLimiter } from "../accounts/rateLimit";
import { isEmptyReport, readContext, readDetails, readFiles, readWords } from "./intake";
import { FeedbackFull, TooManyOpen, unreadOf, waitingOn, type FeedbackRecord, type FeedbackStore } from "./store";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const FEEDBACK_TOKEN_MIN = 24;

export interface FeedbackRoutesOptions {
  store: FeedbackStore;
  adminToken?: string | undefined;
  accountOf?: (request: FastifyRequest) => string | undefined;
  sendsPer10Min?: number | undefined;
}

const KeysSchema = z.object({ keys: z.array(z.string().regex(FEEDBACK_KEY)).max(40) });
const WhoSchema = z.object({ key: z.string().regex(FEEDBACK_KEY).optional(), id: z.string().regex(/^[0-9]{1,9}$/).optional() });
const ReplyBodySchema = WhoSchema.extend({
  text: z.string().max(FEEDBACK_LIMITS.text * 2).catch(""),
  attachments: z.array(z.unknown()).catch([]),
});
const TeamReplySchema = z.object({
  text: z.string().min(1).max(FEEDBACK_LIMITS.text * 2),
  ask: z.boolean().optional(),
  status: z.enum(FEEDBACK_STATUSES).optional(),
});
const TeamPatchSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  tags: z.array(z.string().max(30)).max(12).optional(),
  note: z.string().max(2000).optional(),
});

export const summaryOf = (record: FeedbackRecord): FeedbackSummary => ({
  id: record.id,
  kind: record.kind,
  area: record.area,
  title: record.title,
  status: record.status,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  unread: unreadOf(record),
});

const messageView = (message: FeedbackRecord["messages"][number]): FeedbackMessageView => ({
  id: message.id,
  at: message.at,
  from: message.from === "user" ? "you" : "team",
  text: message.text,
  ...(message.asks ? { asks: true } : {}),
});

const attachmentView = (file: FeedbackRecord["files"][number]): FeedbackAttachmentView => ({
  id: file.id,
  name: file.name,
  mime: file.mime,
  role: file.role,
  ...(file.note ? { note: file.note } : {}),
});

export const threadOf = (record: FeedbackRecord): FeedbackThread => ({
  ...summaryOf(record),
  message: record.message,
  details: record.details,
  ...(record.severity ? { severity: record.severity } : {}),
  ...(record.frequency ? { frequency: record.frequency } : {}),
  attachments: record.files.filter((file) => !file.gone).map(attachmentView),
  messages: record.messages.map(messageView),
});

const adminSummary = (record: FeedbackRecord) => ({
  id: record.id,
  kind: record.kind,
  area: record.area,
  title: record.title,
  status: record.status,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  waiting: waitingOn(record),
  lines: record.messages.length,
  files: record.files.filter((file) => !file.gone).length,
  ...(record.severity ? { severity: record.severity } : {}),
  signedIn: Boolean(record.accountId),
  answerable: record.answer,
  tags: record.tags,
});

const adminFull = (record: FeedbackRecord) => ({
  ...adminSummary(record),
  message: record.message,
  details: record.details,
  ...(record.frequency ? { frequency: record.frequency } : {}),
  account: record.accountId ?? null,
  attachments: record.files,
  context: record.context,
  contextDropped: record.contextDropped ?? [],
  messages: record.messages,
  note: record.note,
});

const tooManyFiles = (body: unknown): boolean => {
  const sent = (body as { attachments?: unknown } | null | undefined)?.attachments;
  return Array.isArray(sent) && sent.length > FEEDBACK_LIMITS.attachments * 4;
};

const tooManyAnswers = (body: unknown): boolean => {
  const sent = (body as { details?: unknown } | null | undefined)?.details;
  if (!sent || typeof sent !== "object" || Array.isArray(sent)) return false;
  let count = 0;
  for (const _name in sent) if (++count > FEEDBACK_DETAIL_KEYS.length * 4) return true;
  return false;
};

const digest = (value: string) => createHash("sha256").update(value).digest();

const tooMany = (reply: FastifyReply, waitMs: number) => {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  return reply.header("Retry-After", seconds).code(429).send({ error: "rate_limited", retryAfter: seconds });
};

const full = (reply: FastifyReply) => reply.header("Retry-After", 3600).code(503).send({ error: "full" });

const tooManyOpen = (reply: FastifyReply) => reply.header("Retry-After", 3600).code(429).send({ error: "too_many_open" });

export function teamGuard(adminToken: string | undefined, kept?: string): (request: FastifyRequest, reply: FastifyReply) => boolean {
  const tokenDigest = typeof adminToken === "string" && adminToken.length >= FEEDBACK_TOKEN_MIN ? digest(adminToken) : undefined;
  const triedToken = new RateLimiter(10, 15 * MINUTE, undefined, kept);
  return (request, reply) => {
    if (!tokenDigest) {
      void reply.code(404).send({ error: "NOT_FOUND" });
      return false;
    }
    const wait = triedToken.wait(request.ip);
    if (wait > 0) {
      void tooMany(reply, wait);
      return false;
    }
    const given = /^Bearer (.+)$/i.exec(request.headers.authorization ?? "")?.[1]?.trim() ?? "";
    if (!timingSafeEqual(digest(given), tokenDigest)) {
      triedToken.hit(request.ip);
      void reply.code(401).send({ error: "unauthorized" });
      return false;
    }
    return true;
  };
}

export const feedbackRoutes: FastifyPluginAsync<FeedbackRoutesOptions> = async (app, { store, adminToken, accountOf, sendsPer10Min = 6 }) => {
  const perAddress = new RateLimiter(sendsPer10Min, 10 * MINUTE, undefined, "feedback.perAddress");
  const perAddressDay = new RateLimiter(Math.max(40, sendsPer10Min * 7), DAY, undefined, "feedback.perAddressDay");
  const everyone = new RateLimiter(Math.max(200, sendsPer10Min * 30), HOUR, undefined, "feedback.everyone");
  const replies = new RateLimiter(30, 10 * MINUTE, undefined, "feedback.replies");
  const reads = new RateLimiter(120, MINUTE);
  const tries = new RateLimiter(Math.max(30, sendsPer10Min * 5), 10 * MINUTE, undefined, "feedback.tries");
  const maxOpen = Math.max(6, sendsPer10Min);
  const counted = async (request: FastifyRequest, reply: FastifyReply) => {
    const wait = tries.wait(request.ip);
    if (wait > 0) return tooMany(reply, wait);
    tries.hit(request.ip);
  };
  const invalid = (reply: FastifyReply) => reply.code(400).send({ error: "invalid_request" });

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  function reportOf(request: FastifyRequest, who: { key?: string | undefined; id?: string | undefined }): FeedbackRecord | undefined {
    if (who.key) {
      const record = store.byKey(who.key);
      if (record) return record;
    }
    const account = accountOf?.(request);
    const record = who.id ? store.get(who.id) : undefined;
    return account && record && record.accountId === account ? record : undefined;
  }

  app.post("/api/feedback", { bodyLimit: FEEDBACK_LIMITS.bodyBytes, onRequest: counted }, async (request, reply) => {
    if (tooManyFiles(request.body) || tooManyAnswers(request.body)) return invalid(reply);
    const parsed = FeedbackInputSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    const input = parsed.data;
    const again = store.byKey(input.key);
    if (again) return reply.send({ id: again.id, status: again.status, createdAt: again.createdAt, rejected: [], again: true });
    const wait = Math.max(perAddress.wait(request.ip), perAddressDay.wait(request.ip), everyone.wait("all"));
    if (wait > 0) return tooMany(reply, wait);

    const details = readDetails(input.details);
    const { title, message } = readWords(input, details);
    const { files, rejected } = readFiles(input.attachments);
    if (isEmptyReport(message, details, files)) return reply.code(400).send({ error: "empty", rejected });
    const { context, dropped } = readContext(input.context);
    const account = input.answer ? accountOf?.(request) : undefined;
    perAddress.hit(request.ip);
    perAddressDay.hit(request.ip);
    everyone.hit("all");
    let made: Awaited<ReturnType<FeedbackStore["create"]>>;
    try {
      made = await store.create(
        {
          key: input.key,
          ...(account ? { accountId: account } : {}),
          kind: input.kind,
          area: input.area,
          title,
          message,
          details,
          severity: input.severity,
          frequency: input.frequency,
          answer: input.answer,
          context,
          ...(dropped.length ? { contextDropped: dropped } : {}),
          files,
          from: request.ip,
        },
        { filesOptional: true, maxOpen },
      );
    } catch (error) {
      if (error instanceof FeedbackFull || error instanceof TooManyOpen) {
        perAddress.undo(request.ip);
        perAddressDay.undo(request.ip);
        everyone.undo("all");
        return error instanceof FeedbackFull ? full(reply) : tooManyOpen(reply);
      }
      throw error;
    }
    const { record, refused } = made;
    return reply.code(201).send({ id: record.id, status: record.status, createdAt: record.createdAt, rejected: [...rejected, ...refused.map((id) => ({ id, reason: "too_big" as const }))] });
  });

  app.post("/api/feedback/check", async (request, reply) => {
    const parsed = KeysSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    const wait = reads.wait(request.ip);
    if (wait > 0) return tooMany(reply, wait);
    reads.hit(request.ip);
    const items = parsed.data.keys.flatMap((key) => {
      const record = store.byKey(key);
      return record?.answer ? [{ key, ...summaryOf(record) }] : [];
    });
    return reply.send({ items });
  });

  app.get("/api/feedback/mine", async (request, reply) => {
    const account = accountOf?.(request);
    if (!account) return reply.code(401).send({ error: "signed_out" });
    const wait = reads.wait(request.ip);
    if (wait > 0) return tooMany(reply, wait);
    reads.hit(request.ip);
    return reply.send({ items: store.forAccount(account).map(summaryOf) });
  });

  app.post("/api/feedback/open", async (request, reply) => {
    const parsed = WhoSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    const wait = reads.wait(request.ip);
    if (wait > 0) return tooMany(reply, wait);
    reads.hit(request.ip);
    const found = reportOf(request, parsed.data);
    if (!found?.answer) return reply.code(404).send({ error: "not_found" });
    const newest = found.messages.reduce((top, message) => (message.from === "team" ? Math.max(top, message.id) : top), 0);
    const opened = newest > found.seen ? await store.update(found.id, (draft) => void (draft.seen = newest), { quiet: true }) : found;
    return reply.send(threadOf(opened ?? found));
  });

  app.post("/api/feedback/reply", { bodyLimit: FEEDBACK_LIMITS.bodyBytes, onRequest: counted }, async (request, reply) => {
    if (tooManyFiles(request.body)) return invalid(reply);
    const parsed = ReplyBodySchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    const wait = replies.wait(request.ip);
    if (wait > 0) return tooMany(reply, wait);
    const found = reportOf(request, parsed.data);
    if (!found?.answer) return reply.code(404).send({ error: "not_found" });
    const text = cleanText(parsed.data.text, FEEDBACK_LIMITS.text);
    const kept = found.files.reduce((sum, file) => sum + (file.gone ? 0 : file.bytes), 0);
    const { files, rejected } = readFiles(parsed.data.attachments, new Set(found.files.map((file) => file.id)), kept);
    if (!text && files.length === 0) return reply.code(400).send({ error: "empty", rejected });
    replies.hit(request.ip);
    const status: FeedbackStatus | undefined = found.status === "needs_info" || found.status === "done" || found.status === "declined" || found.status === "duplicate" ? "in_review" : undefined;
    let added: Awaited<ReturnType<FeedbackStore["addMessage"]>>;
    try {
      added = await store.addMessage(found.id, { from: "user", text, files, ...(status ? { status } : {}) });
    } catch (error) {
      if (error instanceof FeedbackFull) return full(reply);
      throw error;
    }
    if (added === "full") return reply.code(409).send({ error: "thread_full" });
    if (!added) return reply.code(404).send({ error: "not_found" });
    return reply.code(201).send({ message: messageView(added.message), rejected: [...rejected, ...added.refused.map((id) => ({ id, reason: "too_big" as const }))] });
  });

  const team = teamGuard(adminToken, "team.feedback");

  app.get<{ Querystring: { status?: string; kind?: string; area?: string; q?: string; waiting?: string; limit?: string } }>("/api/admin/feedback", async (request, reply) => {
    if (!team(request, reply)) return;
    const { status, kind, area, q, waiting } = request.query;
    const limit = Math.min(500, Math.max(1, Number(request.query.limit) || 100));
    const found = store.list({
      ...(status === "open" || status === "closed" || (FEEDBACK_STATUSES as readonly string[]).includes(status ?? "") ? { status: status as FeedbackStatus | "open" | "closed" } : {}),
      ...((FEEDBACK_KINDS as readonly string[]).includes(kind ?? "") ? { kind: kind as FeedbackKind } : {}),
      ...((FEEDBACK_AREAS as readonly string[]).includes(area ?? "") ? { area: area as FeedbackArea } : {}),
      ...(q ? { q: q.slice(0, 200) } : {}),
      ...(waiting === "1" || waiting === "true" ? { waiting: true } : {}),
    });
    return reply.send({ rev: store.rev, total: found.length, items: found.slice(0, limit).map(adminSummary) });
  });

  app.get<{ Querystring: { since?: string; wait?: string } }>("/api/admin/feedback/changes", async (request, reply) => {
    if (!team(request, reply)) return;
    const since = Number(request.query.since);
    const seconds = Math.min(55, Math.max(0, Number(request.query.wait ?? 25) || 0));
    const gone = new AbortController();
    reply.raw.once("close", () => gone.abort());
    const rev = Number.isInteger(since) ? await store.waitForChange(since, seconds * 1000, gone.signal) : store.rev;
    if (gone.signal.aborted) return reply.code(204).send();
    return reply.send({ rev, items: store.list({ status: "open" }).map(adminSummary) });
  });

  app.get<{ Params: { id: string } }>("/api/admin/feedback/:id", async (request, reply) => {
    if (!team(request, reply)) return;
    const record = store.get(request.params.id);
    return record ? reply.send(adminFull(record)) : reply.code(404).send({ error: "not_found" });
  });

  app.get<{ Params: { id: string; file: string } }>("/api/admin/feedback/:id/files/:file", async (request, reply) => {
    if (!team(request, reply)) return;
    const found = await store.file(request.params.id, request.params.file);
    if (!found) return reply.code(404).send({ error: "not_found" });
    return reply.header("Content-Type", found.meta.mime).header("Content-Disposition", "attachment").header("X-Content-Type-Options", "nosniff").send(found.data);
  });

  app.post<{ Params: { id: string } }>("/api/admin/feedback/:id/reply", async (request, reply) => {
    if (!team(request, reply)) return;
    const parsed = TeamReplySchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    const record = store.get(request.params.id);
    if (!record) return reply.code(404).send({ error: "not_found" });
    if (!record.answer) return reply.code(409).send({ error: "not_answerable" });
    const status: FeedbackStatus = parsed.data.status ?? (parsed.data.ask ? "needs_info" : record.status === "new" ? "in_review" : record.status);
    const added = await store.addMessage(record.id, { from: "team", text: cleanText(parsed.data.text, FEEDBACK_LIMITS.text * 2), asks: Boolean(parsed.data.ask), status });
    if (added === "full") return reply.code(409).send({ error: "thread_full" });
    return added ? reply.code(201).send({ message: added.message, status }) : reply.code(404).send({ error: "not_found" });
  });

  app.patch<{ Params: { id: string } }>("/api/admin/feedback/:id", async (request, reply) => {
    if (!team(request, reply)) return;
    const parsed = TeamPatchSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    const { status, tags, note } = parsed.data;
    const record = await store.update(request.params.id, (draft) => {
      if (status) draft.status = status;
      if (tags) draft.tags = [...new Set(tags.map((tag) => cleanText(tag, 30).toLowerCase()).filter(Boolean))];
      if (note !== undefined) draft.note = cleanText(note, 2000);
    });
    return record ? reply.send(adminFull(record)) : reply.code(404).send({ error: "not_found" });
  });

  app.delete<{ Params: { id: string } }>("/api/admin/feedback/:id", async (request, reply) => {
    if (!team(request, reply)) return;
    return (await store.remove(request.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
  });
};
