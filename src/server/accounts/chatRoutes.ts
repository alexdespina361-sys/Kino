import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ChatMuteSchema, ChatReactSchema, ChatReportSchema, ChatSendSchema, friendChoices, isStickerId, StickerSendSchema, tagLabel, type ChatReportPreview, type ChatTalks, type ChatThread } from "../../shared";
import type { ChatBook, ChatError, ChatOutcome } from "./chat";
import type { FriendRouteHelpers } from "./friendRoutes";
import { DayCount, RateLimiter } from "./rateLimit";
import { sendStickerPicture, stickerRefusal } from "./stickerRoutes";
import type { StickerBook } from "./stickers";

export interface ChatSide {
  id: string;
  label: string;
}

export interface ChatReport {
  reporter: ChatSide;
  about: ChatSide;
  account: string;
  at: number;
  lines: Array<{ at: number; from: "reporter" | "about"; text: string; sticker?: string }>;
  pictures?: Array<{ sticker: string; data: Buffer }>;
}

export const REPORT_STICKER_PICTURES = 7;
export const REPORT_STICKER_BYTES = 1_500_000;
export const CHAT_REPORTS_A_DAY = 6;
export const CHAT_SENDS_AN_HOUR = 600;
export const CHAT_SENDS_A_DAY = 3000;
export type ChatReporter = (report: ChatReport) => Promise<void | "full" | "too_many_open">;

export interface ChatRouteOptions {
  chat: ChatBook;
  report?: ChatReporter;
  stickers?: StickerBook;
}

const MINUTE = 60_000;
const STATUS: Record<ChatError | "changed", number> = {
  not_friends: 404,
  friends_off: 403,
  chat_off: 403,
  empty: 400,
  too_long: 400,
  not_a_picture: 400,
  rate_limited: 429,
  gone: 404,
  changed: 409,
};

type Asked = FastifyRequest & { params: { id: string; fid: string } };

export function chatRoutes(app: FastifyInstance, helpers: FriendRouteHelpers, options: ChatRouteOptions): void {
  const { store } = helpers;
  const { chat, report, stickers } = options;
  const stickersOn = () => (stickers?.on ? stickers : undefined);

  const readsByAccount = new RateLimiter(120, MINUTE);
  const writesByAccount = new RateLimiter(120, MINUTE);
  const reportsByAccount = new RateLimiter(5, 60 * MINUTE, undefined, "chat.reportsByAccount");
  const reportsEveryone = new RateLimiter(60, 60 * MINUTE, undefined, "chat.reportsEveryone");
  const reportsByAccountDay = new RateLimiter(CHAT_REPORTS_A_DAY, 24 * 60 * MINUTE, undefined, "chat.reportsByAccountDay");
  const picturesByAccount = new RateLimiter(600, MINUTE);
  const sendsByAccountHour = new RateLimiter(CHAT_SENDS_AN_HOUR, 60 * MINUTE, undefined, "chat.sendsByAccountHour");
  const sendsByAccountDay = new DayCount(CHAT_SENDS_A_DAY, undefined, "chat.sendsByAccountDay");
  const maySend = (accountId: string, reply: FastifyReply): boolean => {
    const wait = Math.max(sendsByAccountHour.wait(accountId), sendsByAccountDay.wait(accountId));
    if (wait <= 0) return true;
    helpers.tooMany(reply, wait);
    return false;
  };
  const counted = (accountId: string) => (sendsByAccountHour.hit(accountId), sendsByAccountDay.hit(accountId));

  const base = "/api/profiles/:id/friends/:fid/chat";

  function owner(request: FastifyRequest & { params: { id: string } }, reply: FastifyReply, limiter: RateLimiter): { accountId: string; profileId: string } | undefined {
    const auth = helpers.authenticate(request);
    if (!auth) return void helpers.signedOut(reply);
    const profileId = request.params.id;
    if (!store.ownsProfile(auth.accountId, profileId)) return void helpers.refused(reply, "not_found");
    const wait = limiter.wait(auth.accountId);
    if (wait > 0) return void helpers.tooMany(reply, wait);
    limiter.hit(auth.accountId);
    if (!friendChoices(store.settingsOf(profileId)).friends) return void reply.code(STATUS.friends_off).send({ error: "friends_off" });
    return { accountId: auth.accountId, profileId };
  }

  function asker(request: Asked, reply: FastifyReply, limiter: RateLimiter): { accountId: string; profileId: string; friendId: string } | undefined {
    const me = owner(request, reply, limiter);
    return me && { ...me, friendId: request.params.fid };
  }

  const refuse = (reply: FastifyReply, error: ChatError | "changed", waitMs?: number) =>
    error === "rate_limited" ? helpers.tooMany(reply, waitMs ?? MINUTE) : reply.code(STATUS[error]).send({ error });
  const fail = (reply: FastifyReply, outcome: Extract<ChatOutcome<unknown>, { ok: false }>) => refuse(reply, outcome.error, outcome.waitMs);

  app.get<{ Params: { id: string } }>("/api/profiles/:id/chats", async (request, reply) => {
    const me = owner(request, reply, readsByAccount);
    if (!me) return reply;
    const answer: ChatTalks = { talks: chat.talks(me.profileId) };
    return reply.send(answer);
  });

  app.get<{ Params: { id: string; fid: string }; Querystring: { since?: string; reactions?: string } }>(base, async (request, reply) => {
    const me = asker(request, reply, readsByAccount);
    if (!me) return reply;
    const since = /^\d{1,16}$/.test(request.query.since ?? "") ? Number(request.query.since) : undefined;
    const read = chat.readSince(me.profileId, me.friendId, since, request.query.reactions === "1");
    if (!read.ok) return fail(reply, read);
    chat.markSeen(me.profileId, me.friendId);
    const answer: ChatThread = read.value;
    return reply.send(answer);
  });

  app.post<{ Params: { id: string; fid: string } }>(base, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const parsed = ChatSendSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    if (!maySend(me.accountId, reply)) return reply;
    const sent = chat.send(me.profileId, me.friendId, parsed.data.text, parsed.data.replyTo);
    if (sent.ok) counted(me.accountId);
    return sent.ok ? reply.code(201).send(sent.value) : fail(reply, sent);
  });

  app.delete<{ Params: { id: string; fid: string; n: string } }>(`${base}/:n`, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const id = /^\d{1,16}$/.test(request.params.n) ? Number(request.params.n) : undefined;
    if (id === undefined) return refuse(reply, "gone");
    const taken = chat.takeBack(me.profileId, me.friendId, id);
    return taken.ok ? reply.send(taken.value) : fail(reply, taken);
  });

  app.put<{ Params: { id: string; fid: string; n: string } }>(`${base}/:n/reaction`, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const id = /^\d{1,16}$/.test(request.params.n) ? Number(request.params.n) : undefined;
    if (id === undefined) return refuse(reply, "gone");
    const parsed = ChatReactSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    const reacted = chat.react(me.profileId, me.friendId, id, parsed.data.reaction);
    return reacted.ok ? reply.send(reacted.value) : fail(reply, reacted);
  });

  app.put<{ Params: { id: string; fid: string } }>(`${base}/mute`, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const parsed = ChatMuteSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    const muted = chat.mute(me.profileId, me.friendId, parsed.data.muted);
    return muted.ok ? reply.send({ muted: muted.value }) : fail(reply, muted);
  });

  const sideOf = (profileId: string): ChatSide => {
    const card = store.profileCard(profileId);
    return { id: profileId, label: card ? (card.tag !== undefined ? tagLabel(card.name, card.tag) : card.name) : profileId };
  };

  app.get<{ Params: { id: string; fid: string } }>(`${base}/report`, async (request, reply) => {
    const me = asker(request, reply, readsByAccount);
    if (!me) return reply;
    if (!report) return helpers.refused(reply, "not_found");
    const held = chat.lastLines(me.profileId, me.friendId);
    if (!held.ok) return fail(reply, held);
    const preview: ChatReportPreview = held.value;
    return reply.send(preview);
  });

  app.post<{ Params: { id: string; fid: string } }>(`${base}/report`, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    if (!report) return helpers.refused(reply, "not_found");
    const parsed = ChatReportSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    const wait = Math.max(reportsByAccount.wait(me.accountId), reportsByAccountDay.wait(me.accountId), reportsEveryone.wait("all"));
    if (wait > 0) return helpers.tooMany(reply, wait);
    const held = chat.lastLines(me.profileId, me.friendId);
    if (!held.ok) return fail(reply, held);
    if (held.value.rev !== parsed.data.rev) return refuse(reply, "changed");
    if (held.value.lines.length === 0) return refuse(reply, "gone");
    reportsByAccount.hit(me.accountId);
    reportsByAccountDay.hit(me.accountId);
    reportsEveryone.hit("all");
    const named = [...new Set(held.value.lines.map((line) => line.sticker).filter(isStickerId).reverse())].slice(0, REPORT_STICKER_PICTURES);
    const pictures: Array<{ sticker: string; data: Buffer }> = [];
    let bytes = 0;
    for (const sticker of named) {
      const data = await stickers?.picture(sticker).catch(() => undefined);
      if (!data || bytes + data.length > REPORT_STICKER_BYTES) continue;
      bytes += data.length;
      pictures.push({ sticker, data });
    }
    const sent = await report({
      reporter: sideOf(me.profileId),
      about: sideOf(me.friendId),
      account: me.accountId,
      at: store.clock(),
      lines: held.value.lines.map((line) => ({ at: line.at, from: line.mine ? "reporter" : "about", text: line.text, ...(isStickerId(line.sticker) ? { sticker: line.sticker } : {}) })),
      ...(pictures.length > 0 ? { pictures } : {}),
    });
    if (sent === "full" || sent === "too_many_open") {
      reportsByAccount.undo(me.accountId);
      reportsByAccountDay.undo(me.accountId);
      reportsEveryone.undo("all");
      return reply.header("Retry-After", 3600).code(sent === "full" ? 503 : 429).send({ error: sent });
    }
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string; fid: string } }>(`${base}/sticker`, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const book = stickersOn();
    if (!book) return stickerRefusal(reply, "off");
    const parsed = StickerSendSchema.safeParse(request.body);
    if (!parsed.success) return helpers.invalid(reply, parsed.error);
    if (!book.holds(me.profileId, parsed.data.id)) return refuse(reply, "gone");
    if (!maySend(me.accountId, reply)) return reply;
    const sent = chat.sendSticker(me.profileId, me.friendId, parsed.data.id, parsed.data.replyTo);
    if (sent.ok) counted(me.accountId);
    return sent.ok ? reply.code(201).send(sent.value) : fail(reply, sent);
  });

  app.get<{ Params: { id: string; fid: string; sid: string } }>(`${base}/stickers/:sid`, async (request, reply) => {
    const me = asker(request, reply, stickers?.pictureReads ?? picturesByAccount);
    if (!me) return reply;
    const book = stickersOn();
    if (!book) return stickerRefusal(reply, "off");
    const { sid } = request.params;
    if (!isStickerId(sid) || !chat.hasSticker(me.profileId, me.friendId, sid)) return refuse(reply, "gone");
    const data = await book.picture(sid);
    return data ? sendStickerPicture(reply, data) : refuse(reply, "gone");
  });

  app.post<{ Params: { id: string; fid: string; sid: string } }>(`${base}/stickers/:sid/save`, async (request, reply) => {
    const me = asker(request, reply, writesByAccount);
    if (!me) return reply;
    const book = stickersOn();
    if (!book) return stickerRefusal(reply, "off");
    const { sid } = request.params;
    if (!isStickerId(sid) || !chat.hasSticker(me.profileId, me.friendId, sid)) return refuse(reply, "gone");
    const saved = book.save(me.profileId, sid);
    return saved.ok ? reply.send(book.of(me.profileId)) : stickerRefusal(reply, saved.error, saved.waitMs);
  });
}
